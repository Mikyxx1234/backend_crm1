/**
 * Converte uma URL de mídia (absoluta ou relativa, ex.: `/uploads/x.mp4`,
 * `/api/storage/<org>/<bucket>/<file>`) numa URL HTTPS absoluta e pública,
 * exigida pela Meta ao enviar `header.parameters[].{image,video,document}.link`
 * em templates (erro `132012` quando o link está ausente/inacessível).
 *
 * A Meta busca essa URL diretamente dos servidores dela — precisa ser
 * HTTPS e alcançável sem autenticação (cookie de sessão não é enviado).
 */
export function toAbsolutePublicMediaUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("toAbsolutePublicMediaUrl: URL vazia.");
  }

  if (trimmed.startsWith("https://")) return trimmed;

  if (trimmed.startsWith("http://")) {
    throw new Error(
      `toAbsolutePublicMediaUrl: a Meta exige HTTPS para mídia de header; URL recebida em http:// (${trimmed}).`,
    );
  }

  if (!trimmed.startsWith("/")) {
    throw new Error(
      `toAbsolutePublicMediaUrl: URL de mídia inválida (esperado https:// absoluto ou caminho relativo iniciado por "/"): ${trimmed}`,
    );
  }

  const base = (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    ""
  ).trim().replace(/\/$/, "");

  if (!base) {
    throw new Error(
      "toAbsolutePublicMediaUrl: URL de mídia relativa recebida, mas nenhuma base pública configurada " +
        "(defina BACKEND_PUBLIC_URL, NEXT_PUBLIC_API_BASE_URL ou NEXTAUTH_URL).",
    );
  }

  if (!base.startsWith("https://")) {
    throw new Error(
      `toAbsolutePublicMediaUrl: a base pública configurada (${base}) não é HTTPS; a Meta exige HTTPS para mídia de header.`,
    );
  }

  return `${base}${trimmed}`;
}
