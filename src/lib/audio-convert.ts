import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import os from "os";
import path from "path";

import { isOggOpus, repacketizeOggOpusToCode3 } from "@/lib/ogg-opus-ptt";

/** MIME oficial da Meta para OGG/Opus. `audio/ogg` sem codecs é rejeitado (131053). */
export const WHATSAPP_VOICE_MIME = "audio/ogg; codecs=opus";
/** Limite Cloud API para áudio. */
export const WHATSAPP_AUDIO_MAX_BYTES = 16 * 1024 * 1024;

function resolveFFmpeg(): string {
  // Preferimos o ffmpeg DO SISTEMA (apt-get install ffmpeg) ao binário do
  // `ffmpeg-static`. Motivo: o pacote npm baixa um build minimalista que
  // frequentemente não inclui `libopus`/`libmp3lame`, fazendo as estratégias
  // de transcode falharem silenciosamente. O ffmpeg do Debian é completo,
  // estável e tem todos os codecs necessários (Opus pra PTT, MP3 pra
  // download universal). Mantemos `ffmpeg-static` só como último recurso
  // pra ambientes onde ffmpeg não pôde ser instalado (ex.: Lambda).
  try {
    execFileSync("ffmpeg", ["-version"], { timeout: 5000, stdio: "pipe" });
    console.log("[audio-convert] Usando ffmpeg do sistema (PATH)");
    return "ffmpeg";
  } catch { /* not in PATH, try static */ }

  try {
    const staticBin = require("ffmpeg-static") as string;
    if (staticBin && existsSync(staticBin)) {
      console.log("[audio-convert] Usando ffmpeg-static (fallback):", staticBin);
      return staticBin;
    }
  } catch { /* ffmpeg-static not available */ }

  console.warn("[audio-convert] ffmpeg nao encontrado nem no PATH nem via ffmpeg-static");
  return "ffmpeg";
}

let _ffmpeg: string | undefined;
function getFFmpeg(): string {
  if (!_ffmpeg) _ffmpeg = resolveFFmpeg();
  return _ffmpeg;
}

const TMP_DIR = path.join(os.tmpdir(), "crm-audio-convert");

const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // "OggS"

/**
 * Validate that a buffer is a valid OGG file by checking magic bytes
 * and minimum size (a valid OGG/Opus file is at least ~200 bytes).
 */
export function isValidOgg(buf: Buffer): boolean {
  return buf.length >= 200 && buf.subarray(0, 4).equals(OGG_MAGIC);
}

/**
 * Voice message Meta: OGG + OPUS, mono. 16 kHz / 20 ms / voip replica o PTT nativo.
 * 48 kHz e remux/experimental opus o iOS recusa.
 */
function getConversionStrategies(): { label: string; args: string[] }[] {
  return [
    {
      label: "libopus 16k voip 20ms",
      args: [
        "-c:a", "libopus",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "24k",
        "-application", "voip",
        "-frame_duration", "20",
        "-map_metadata", "-1",
        "-f", "ogg",
      ],
    },
    {
      label: "libopus 16k voip",
      args: [
        "-c:a", "libopus",
        "-ac", "1",
        "-ar", "16000",
        "-b:a", "24k",
        "-application", "voip",
        "-map_metadata", "-1",
        "-f", "ogg",
      ],
    },
  ];
}

function runFFmpeg(bin: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs }, (error, _stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stderr: stderr?.slice(-500) ?? error.message });
      } else {
        resolve({ ok: true, stderr: stderr ?? "" });
      }
    });
  });
}

/**
 * Converts any audio buffer to OGG/Opus via FFmpeg.
 * Só reencoda com libopus. Remux/experimental opus não entram mais:
 * o iOS recusa o PTT mesmo com OggS válido.
 * Returns the converted buffer, or null if libopus falhar.
 */
export async function convertToOgg(
  inputBuffer: Buffer,
  inputExt = "webm",
): Promise<Buffer | null> {
  await mkdir(TMP_DIR, { recursive: true });

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const inputPath = path.join(TMP_DIR, `in-${ts}-${rand}.${inputExt}`);
  const outputPath = path.join(TMP_DIR, `out-${ts}-${rand}.ogg`);

  try {
    await writeFile(inputPath, inputBuffer);

    const bin = getFFmpeg();
    const strategies = getConversionStrategies();

    for (const strategy of strategies) {
      const fullArgs = ["-i", inputPath, "-vn", ...strategy.args, "-y", outputPath];
      console.log(`[ffmpeg] Tentando ${strategy.label}: ${bin} ${fullArgs.join(" ")}`);

      const { ok, stderr } = await runFFmpeg(bin, fullArgs);

      if (!ok) {
        console.warn(`[ffmpeg] Estrategia "${strategy.label}" falhou: ${stderr.slice(-200)}`);
        await unlink(outputPath).catch(() => {});
        continue;
      }

      if (!existsSync(outputPath)) {
        console.warn(`[ffmpeg] Estrategia "${strategy.label}" nao gerou arquivo de saida`);
        continue;
      }

      const result = await readFile(outputPath);

      if (!isOggOpus(result)) {
        console.warn(`[ffmpeg] Estrategia "${strategy.label}" gerou arquivo invalido (${result.length} bytes, magic: ${result.subarray(0, 4).toString("hex")})`);
        await unlink(outputPath).catch(() => {});
        continue;
      }

      console.log(`[ffmpeg] Conversao OK via "${strategy.label}": ${inputBuffer.length} -> ${result.length} bytes`);
      return result;
    }

    console.error("[audio-convert] Todas as estrategias de conversao falharam");
    return null;
  } catch (err) {
    console.error("[audio-convert] FFmpeg conversion error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Convert any audio buffer to MP3 (audio/mpeg) via FFmpeg.
 *
 * Use case: download de áudios do chat sempre como `.mp3` — formato
 * universal que abre em qualquer player desktop/mobile sem precisar
 * de plugin (ao contrário de `.ogg`/`.opus`/`.webm` que vêm da
 * Meta/WhatsApp e às vezes não tocam direto fora do navegador).
 *
 * Estratégia: transcode com `libmp3lame` (encoder MP3 padrão do
 * ffmpeg). Bitrate 128kbps + canais mono — voz humana cabe
 * confortavelmente nesse perfil e mantém arquivos pequenos
 * (~1MB/min). Sample rate 44.1kHz para máxima compatibilidade.
 *
 * Retorna `null` se ffmpeg falhar (sem libmp3lame, input corrompido,
 * timeout, etc) — caller deve cair pro arquivo original como fallback.
 */
export async function convertToMp3(
  inputBuffer: Buffer,
  inputExt = "webm",
): Promise<Buffer | null> {
  await mkdir(TMP_DIR, { recursive: true });

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const inputPath = path.join(TMP_DIR, `in-${ts}-${rand}.${inputExt}`);
  const outputPath = path.join(TMP_DIR, `out-${ts}-${rand}.mp3`);

  try {
    await writeFile(inputPath, inputBuffer);

    const bin = getFFmpeg();
    const args = [
      "-i", inputPath,
      "-vn",
      "-acodec", "libmp3lame",
      "-ar", "44100",
      "-ac", "1",
      "-b:a", "128k",
      "-y",
      outputPath,
    ];

    console.log(`[ffmpeg] Convertendo pra MP3: ${bin} ${args.join(" ")}`);
    const { ok, stderr } = await runFFmpeg(bin, args);

    if (!ok) {
      console.warn(`[ffmpeg] Conversao MP3 falhou: ${stderr.slice(-300)}`);
      return null;
    }

    if (!existsSync(outputPath)) {
      console.warn("[ffmpeg] MP3 nao foi gerado");
      return null;
    }

    const result = await readFile(outputPath);
    console.log(`[ffmpeg] Conversao MP3 OK: ${inputBuffer.length} -> ${result.length} bytes`);
    return result;
  } catch (err) {
    console.error("[audio-convert] MP3 conversion error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * Convert any audio buffer to M4A/AAC (audio/mp4) via FFmpeg.
 *
 * Encoder `aac` é nativo do ffmpeg (não depende de libopus/libmp3lame).
 * A Meta aceita `audio/mp4` como áudio regular (não-PTT) — o formato que
 * o WhatsApp iOS reproduz com estabilidade.
 */
export async function convertToM4a(
  inputBuffer: Buffer,
  inputExt = "webm",
): Promise<Buffer | null> {
  await mkdir(TMP_DIR, { recursive: true });

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const inputPath = path.join(TMP_DIR, `in-${ts}-${rand}.${inputExt}`);
  const outputPath = path.join(TMP_DIR, `out-${ts}-${rand}.m4a`);

  const strategies = [
    { label: "aac native", args: ["-c:a", "aac"] },
    { label: "libfdk_aac", args: ["-c:a", "libfdk_aac"] },
  ];

  try {
    await writeFile(inputPath, inputBuffer);
    const bin = getFFmpeg();

    for (const strategy of strategies) {
      const args = [
        "-i", inputPath,
        "-vn",
        ...strategy.args,
        "-ar", "44100",
        "-ac", "1",
        "-b:a", "96k",
        "-movflags", "+faststart",
        "-f", "mp4",
        "-y",
        outputPath,
      ];
      console.log(`[ffmpeg] Convertendo pra M4A/AAC (${strategy.label}): ${bin} ${args.join(" ")}`);
      const { ok, stderr } = await runFFmpeg(bin, args);
      if (!ok) {
        console.warn(`[ffmpeg] Conversao M4A ${strategy.label} falhou: ${stderr.slice(-300)}`);
        await unlink(outputPath).catch(() => {});
        continue;
      }
      if (!existsSync(outputPath)) continue;
      const result = await readFile(outputPath);
      if (result.length === 0) continue;
      console.log(`[ffmpeg] Conversao M4A OK (${strategy.label}): ${inputBuffer.length} -> ${result.length} bytes`);
      return result;
    }
    return null;
  } catch (err) {
    console.error("[audio-convert] M4A conversion error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

function guessInputExtFromBuffer(buf: Buffer, mimeBase: string): string {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(OGG_MAGIC)) return "ogg";
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "webm";
  }
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "m4a";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    return "wav";
  }
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") return "mp3";
  return guessInputExt(mimeBase);
}

export type WhatsAppAudioPayload = {
  buffer: Buffer;
  mime: string;
  fileName: string;
  voice: boolean;
};

function withAudioExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim() || "audio";
  return `${base}.${ext}`;
}

/**
 * Áudio de saída WhatsApp (Cloud API e Baileys) — mensagem de voz, nunca document.
 *
 * Meta (audio-messages):
 *   - Voice: .ogg OPUS, mono, `voice: true`. Outro codec/container falha transcrição.
 *   - MIME: `audio/ogg; codecs=opus` (base `audio/ogg` não é suportado).
 *   - Extensão .ogg tem que bater com o MIME.
 *   - Máx. 16 MB. Ícone de play só até 512 KB.
 * WebM do browser não está na lista — sempre reencodar com libopus.
 * Sem fallback AAC/MP3: isso vira "basic audio" (arquivo AUD-… + fone).
 */
export async function prepareWhatsAppAudio(
  inputBuffer: Buffer,
  inputExt: string,
  originalName: string,
): Promise<WhatsAppAudioPayload | null> {
  const ext = guessInputExtFromBuffer(inputBuffer, mimeFromExtension(inputExt) || `audio/${inputExt}`);

  const ogg = await convertToOgg(inputBuffer, ext);
  if (!ogg || !isOggOpus(ogg)) return null;

  let packed: Buffer;
  try {
    packed = repacketizeOggOpusToCode3(ogg);
  } catch (err) {
    console.warn(
      "[audio-convert] repacketize code-3 falhou, enviando libopus original:",
      err instanceof Error ? err.message : err,
    );
    packed = ogg;
  }
  if (!isOggOpus(packed) || packed.length > WHATSAPP_AUDIO_MAX_BYTES) return null;

  return {
    buffer: packed,
    mime: WHATSAPP_VOICE_MIME,
    fileName: withAudioExt(originalName, "ogg"),
    voice: true,
  };
}

/**
 * Convert any audio buffer to WAV 16kHz mono — formato canônico
 * exigido pelo Whisper (OpenAI) e a maioria dos modelos de ASR.
 *
 * Sem essa conversão, mandar `.ogg`/`.opus` direto pra Hugging Face
 * Inference API funciona ÀS VEZES (depende do servidor decodificar
 * Opus), mas WAV 16kHz mono é o "lingua franca" garantido — Whisper
 * espera exatamente isso internamente, então economiza um decode
 * server-side e melhora a estabilidade.
 */
export async function convertToWav16k(
  inputBuffer: Buffer,
  inputExt = "webm",
): Promise<Buffer | null> {
  await mkdir(TMP_DIR, { recursive: true });

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const inputPath = path.join(TMP_DIR, `in-${ts}-${rand}.${inputExt}`);
  const outputPath = path.join(TMP_DIR, `out-${ts}-${rand}.wav`);

  try {
    await writeFile(inputPath, inputBuffer);
    const bin = getFFmpeg();
    const args = [
      "-i", inputPath,
      "-vn",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "-y",
      outputPath,
    ];
    const { ok, stderr } = await runFFmpeg(bin, args);
    if (!ok) {
      console.warn(`[ffmpeg] Conversao WAV16k falhou: ${stderr.slice(-300)}`);
      return null;
    }
    if (!existsSync(outputPath)) return null;
    return await readFile(outputPath);
  } catch (err) {
    console.error("[audio-convert] WAV16k conversion error:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

/**
 * WhatsApp PTT (voice messages) REQUIRE audio/ogg with Opus codec.
 * Only audio/ogg should skip conversion for voice messages.
 */
export function needsVoiceConversion(mimeBase: string): boolean {
  const base = mimeBase.split(";")[0].trim();
  return base !== "audio/ogg";
}

export function guessInputExt(mimeBase: string): string {
  const base = mimeBase.split(";")[0].trim();
  switch (base) {
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
      return "wav";
    case "audio/aac":
      return "aac";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    default:
      return "bin";
  }
}

/**
 * Resolve MIME from file extension — used as fallback when blob MIME is missing.
 */
export function mimeFromExtension(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "mp4":
    case "m4a":
      return "audio/mp4";
    case "mp3":
      return "audio/mpeg";
    case "aac":
      return "audio/aac";
    case "webm":
      return "audio/webm";
    case "wav":
      return "audio/wav";
    case "amr":
      return "audio/amr";
    default:
      return null;
  }
}

/** Meta rejeita `audio/ogg` e `audio/opus`. Upload de voz exige codecs=opus. */
export function whatsappUploadAudioMime(mimeType: string, fileName: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (base === "audio/ogg" || base === "audio/opus" || ext === "ogg" || ext === "opus") {
    return WHATSAPP_VOICE_MIME;
  }
  return mimeType;
}
