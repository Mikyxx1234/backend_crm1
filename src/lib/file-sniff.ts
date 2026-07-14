/**
 * Detecção de tipo de arquivo por magic bytes (defesa em profundidade
 * contra upload de conteúdo malicioso).
 *
 * O `Content-Type` do multipart vem do cliente e é trivialmente
 * falsificável — não deve ser usado sozinho para autorizar armazenar
 * o arquivo nem para derivar a extensão. Estas funções olham o cabeçalho
 * binário real e retornam o tipo canonicalizado, ou `null` se o
 * conteúdo não bate com nenhum formato permitido.
 *
 * Formatos suportados aqui refletem o que o CRM precisa aceitar. SVG,
 * HTML, arquivos executáveis, PDFs criptografados etc. caem em `null`
 * e devem ser rejeitados pelo caller.
 */

export type SniffedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export type SniffedVideoMime = "video/mp4" | "video/webm" | "video/quicktime";
export type SniffedAudioMime =
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/webm"
  | "audio/wav";
export type SniffedDocMime = "application/pdf";

export type SniffedMime =
  | SniffedImageMime
  | SniffedVideoMime
  | SniffedAudioMime
  | SniffedDocMime;

function eq(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

export function sniffImageMime(buf: Buffer): SniffedImageMime | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (eq(buf, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (eq(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WEBP: "RIFF" .... "WEBP"
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  // GIF: "GIF87a" ou "GIF89a"
  if (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a") {
    return "image/gif";
  }
  // SVG e outros formatos texto/vetoriais caem aqui como null e devem
  // ser rejeitados — SVG pode conter <script> e é vetor XSS quando
  // servido como image/svg+xml sob a mesma origem.
  return null;
}

export function sniffVideoMime(buf: Buffer): SniffedVideoMime | null {
  if (buf.length < 12) return null;
  // MP4/MOV: "....ftyp...."
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    // isom, mp42, mp41, avc1, iso2, M4V, etc → mp4
    return "video/mp4";
  }
  // WebM/Matroska: 1A 45 DF A3
  if (eq(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  return null;
}

export function sniffAudioMime(buf: Buffer): SniffedAudioMime | null {
  if (buf.length < 12) return null;
  // MP3 com ID3v2: "ID3"
  if (buf.toString("ascii", 0, 3) === "ID3") return "audio/mpeg";
  // MP3 frame sync: FF Ex/Fx
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  // WAV: "RIFF"...."WAVE"
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    return "audio/wav";
  }
  // OGG: "OggS"
  if (buf.toString("ascii", 0, 4) === "OggS") return "audio/ogg";
  // M4A: "....ftypM4A "
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand.startsWith("M4A")) return "audio/mp4";
  }
  // WebM (áudio compartilha o mesmo container)
  if (eq(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  return null;
}

export function sniffDocMime(buf: Buffer): SniffedDocMime | null {
  if (buf.length < 5) return null;
  // PDF: "%PDF-"
  if (buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function extForMime(mime: SniffedMime): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "weba";
    case "audio/wav":
      return "wav";
    case "application/pdf":
      return "pdf";
  }
}
