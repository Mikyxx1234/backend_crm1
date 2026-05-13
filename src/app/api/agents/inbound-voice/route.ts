import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { listInboundVoiceAgents } from "@/services/inbound-voice-availability";

/** Lista agentes que neste momento podem receber ligações WhatsApp (Calling). */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Não autorizado." }, { status: 401 });
  }

  const agents = await listInboundVoiceAgents();
  return NextResponse.json({ count: agents.length, agents });
}
