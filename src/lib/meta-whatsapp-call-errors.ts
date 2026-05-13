/**
 * Erros conhecidos do Graph na API de chamadas WhatsApp (Cloud API).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/calling
 */
export function mapMetaWhatsappCallGraphError(raw: string): { status: number; message: string } | null {
  const lower = raw.trim().toLowerCase();
  if (lower.includes("already ongoing") && lower.includes("receiver")) {
    return {
      status: 409,
      message:
        "Já existe uma chamada em curso com este contato no WhatsApp. Use «Encerrar ligação» (ou «Encerrar chamada» se estiver ativa no histórico), aguarde alguns segundos e tente de novo.",
    };
  }
  if (lower.includes("already ongoing")) {
    return {
      status: 409,
      message:
        "Já existe uma chamada em curso. Termine-a na Meta antes de iniciar outra.",
    };
  }
  return null;
}
