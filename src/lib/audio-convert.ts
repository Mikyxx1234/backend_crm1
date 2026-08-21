import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { writeFile, readFile, unlink, mkdir } from "fs/promises";
import os from "os";
import path from "path";

import {
  isOggOpus,
  muxOggOpus,
  oggOpusChannels,
  repacketizeOggOpusToCode3,
} from "@/lib/ogg-opus-ptt";
import { demuxWebmOpus } from "@/lib/webm-opus";

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

export type FFmpegCapabilities = {
  available: boolean;
  bin: string;
  /** `libopus` presente na lista de encoders — obrigatório para transcodar PTT. */
  libopus: boolean;
  libmp3lame: boolean;
};

let _caps: FFmpegCapabilities | undefined;

/**
 * Descobre uma vez por processo se o ffmpeg existe e quais encoders ele tem.
 *
 * Sem isso, "conversão falhou" era indistinguível de "ffmpeg sem libopus" —
 * o operador via um toast genérico e a gente ficava adivinhando no log.
 */
export function ffmpegCapabilities(): FFmpegCapabilities {
  if (_caps) return _caps;
  const bin = getFFmpeg();
  try {
    const out = execFileSync(bin, ["-hide_banner", "-encoders"], {
      timeout: 10_000,
      stdio: "pipe",
      maxBuffer: 8 * 1024 * 1024,
    }).toString();
    _caps = {
      available: true,
      bin,
      libopus: /\blibopus\b/.test(out),
      libmp3lame: /\blibmp3lame\b/.test(out),
    };
  } catch {
    _caps = { available: false, bin, libopus: false, libmp3lame: false };
  }
  console.log(
    `[audio-convert] ffmpeg=${_caps.available ? _caps.bin : "AUSENTE"} libopus=${_caps.libopus} libmp3lame=${_caps.libmp3lame}`,
  );
  return _caps;
}

const TMP_DIR = path.join(os.tmpdir(), "crm-audio-convert");

const OGG_MAGIC = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // "OggS"

/**
 * Voice message Meta: OGG + OPUS, mono. 16 kHz / 20 ms / voip replica o PTT nativo.
 * 48 kHz e remux/experimental opus o iOS recusa.
 */
function getConversionStrategies(): { label: string; args: string[] }[] {
  const caps = ffmpegCapabilities();
  if (caps.available && !caps.libopus) {
    // Build sem libopus: o encoder `opus` nativo é experimental (exige
    // `-strict -2`) e gera Opus válido. Não é o ideal, mas é infinitamente
    // melhor que falhar o envio — sem Opus não existe nota de voz na Meta.
    return [
      {
        label: "opus nativo (experimental, sem libopus)",
        args: [
          "-c:a", "opus",
          "-strict", "-2",
          "-ac", "1",
          "-ar", "48000",
          "-b:a", "24k",
          "-map_metadata", "-1",
          "-f", "ogg",
        ],
      },
    ];
  }
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

export type PrepareAudioResult =
  | { ok: true; payload: WhatsAppAudioPayload }
  | { ok: false; reason: string };

/** Aplica o layout de nota de voz nativa e valida o resultado final. */
function finalizeVoiceOgg(ogg: Buffer, originalName: string): PrepareAudioResult {
  const channels = oggOpusChannels(ogg);
  if (channels !== null && channels !== 1) {
    return { ok: false, reason: `Opus com ${channels} canais; a Meta aceita só mono em nota de voz.` };
  }

  let packed: Buffer;
  try {
    packed = repacketizeOggOpusToCode3(ogg);
  } catch (err) {
    console.warn(
      "[audio-convert] repacketize code-3 falhou, enviando Opus original:",
      err instanceof Error ? err.message : err,
    );
    packed = ogg;
  }
  if (!isOggOpus(packed)) return { ok: false, reason: "Ogg/Opus gerado saiu inválido." };
  if (packed.length > WHATSAPP_AUDIO_MAX_BYTES) {
    return { ok: false, reason: "Áudio acima do limite de 16 MB da Cloud API." };
  }

  return {
    ok: true,
    payload: {
      buffer: packed,
      mime: WHATSAPP_VOICE_MIME,
      fileName: withAudioExt(originalName, "ogg"),
      voice: true,
    },
  };
}

/**
 * Áudio de saída WhatsApp (Cloud API e Baileys) — mensagem de voz, nunca document.
 *
 * Meta (audio-messages):
 *   - Voice: .ogg OPUS, mono, `voice: true`. Outro codec/container falha transcrição.
 *   - MIME: `audio/ogg; codecs=opus` (base `audio/ogg` não é suportado).
 *   - Extensão .ogg tem que bater com o MIME.
 *   - Máx. 16 MB. Ícone de play só até 512 KB.
 *
 * Ordem das estratégias:
 *   1. Já é Ogg/Opus → só reempacota. Zero dependência externa.
 *   2. WebM/Opus (todo `MediaRecorder` de Chromium/Firefox) → troca de
 *      container em JS puro. Lossless e também sem depender de ffmpeg — este é
 *      o caminho de 99% das notas de voz gravadas no CRM.
 *   3. Qualquer outro container/codec (mp3, m4a, wav, amr) → transcode Opus
 *      via ffmpeg, que aqui é a única etapa que precisa do binário.
 *
 * Sem fallback AAC/MP3: isso vira "basic audio" (arquivo AUD-… + fone).
 */
export async function prepareWhatsAppAudio(
  inputBuffer: Buffer,
  inputExt: string,
  originalName: string,
): Promise<PrepareAudioResult> {
  if (!inputBuffer.length) return { ok: false, reason: "Arquivo de áudio vazio." };

  const ext = guessInputExtFromBuffer(inputBuffer, mimeFromExtension(inputExt) || `audio/${inputExt}`);

  if (isOggOpus(inputBuffer)) {
    console.log("[audio-convert] entrada já é Ogg/Opus — reempacotando sem transcode");
    const direct = finalizeVoiceOgg(inputBuffer, originalName);
    if (direct.ok) return direct;
    console.warn(`[audio-convert] reempacote direto rejeitado: ${direct.reason}`);
  }

  if (ext === "webm") {
    const track = demuxWebmOpus(inputBuffer);
    if (track && track.channels === 1) {
      try {
        const remuxed = muxOggOpus(track.opusHead, track.packets);
        console.log(
          `[audio-convert] remux WebM/Opus -> Ogg/Opus sem ffmpeg: ${inputBuffer.length} -> ${remuxed.length} bytes (${track.packets.length} pacotes)`,
        );
        const result = finalizeVoiceOgg(remuxed, originalName);
        if (result.ok) return result;
        console.warn(`[audio-convert] remux rejeitado: ${result.reason}`);
      } catch (err) {
        console.warn(
          "[audio-convert] remux WebM/Opus falhou, caindo pro ffmpeg:",
          err instanceof Error ? err.message : err,
        );
      }
    } else if (track) {
      console.log(`[audio-convert] WebM/Opus com ${track.channels} canais — transcodando pra mono`);
    }
  }

  const caps = ffmpegCapabilities();
  if (!caps.available) {
    return {
      ok: false,
      reason: `Formato ${ext} exige transcode e o FFmpeg não está instalado no servidor.`,
    };
  }

  const ogg = await convertToOgg(inputBuffer, ext);
  if (!ogg || !isOggOpus(ogg)) {
    return {
      ok: false,
      reason: caps.libopus
        ? `FFmpeg não conseguiu converter este ${ext} para Ogg/Opus.`
        : "FFmpeg instalado sem libopus — não é possível gerar Ogg/Opus para nota de voz.",
    };
  }

  return finalizeVoiceOgg(ogg, originalName);
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
