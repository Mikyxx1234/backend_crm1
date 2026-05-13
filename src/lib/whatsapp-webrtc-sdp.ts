/**
 * Meta/WhatsApp Cloud Calling — SDP answer por vezes falha no Chrome
 * ("Invalid SDP line" em a=ssrc / cname). Reescrevemos o token cname; se ainda falhar,
 * o hook pode chamar `stripSsrcLinesFromSdp` como segundo passo.
 */
function normalizeSdpBody(sdp: string): string {
  let s = sdp.replace(/\u200B|\u200C|\u200D|\uFEFF/g, "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/([^\n])(a=[a-z])/gi, "$1\n$2");
  return s;
}

function processLines(
  lines: string[],
  mode: "rewrite-ssrc" | "drop-ssrc"
): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let u = t;
    if (/^a=fingerprint:sha-256/i.test(u)) {
      u = u.replace(/^a=fingerprint:sha-256/i, "a=fingerprint:SHA-256");
    }
    if (/^a=ssrc:/i.test(u)) {
      if (mode === "drop-ssrc") continue;
      const m = /^a=ssrc:(\d+)\s+cname:(\S+)(\s.*)?$/i.exec(u);
      if (m) {
        const id = m[1];
        const raw = m[2];
        const tail = (m[3] ?? "").trim();
        const safe = raw.replace(/[^a-zA-Z0-9_.-]/g, "").toLowerCase().slice(0, 32) || "wa";
        u = tail ? `a=ssrc:${id} cname:${safe} ${tail}` : `a=ssrc:${id} cname:${safe}`;
      }
    }
    out.push(u);
  }
  return out;
}

export function sanitizeMetaWhatsappSdpForBrowser(sdp: string): string {
  const lines = normalizeSdpBody(sdp)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  const out = processLines(lines, "rewrite-ssrc");
  const body = out.join("\r\n");
  return body.endsWith("\r\n") ? body : `${body}\r\n`;
}

/** Segundo passo se setRemoteDescription ainda falhar após sanitizeMetaWhatsappSdpForBrowser. */
export function stripSsrcLinesFromSdp(sdp: string): string {
  const lines = normalizeSdpBody(sdp)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""));
  const out = processLines(lines, "drop-ssrc");
  const body = out.join("\r\n");
  return body.endsWith("\r\n") ? body : `${body}\r\n`;
}
