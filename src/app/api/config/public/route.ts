import { NextResponse } from "next/server";

import {
  CRM_META_APP_ID,
  CRM_META_ES_CONFIG_ID,
  CRM_META_MESSENGER_CONFIG_ID,
} from "@/lib/meta-constants";

export function GET() {
  return NextResponse.json({
    metaAppId: CRM_META_APP_ID,
    metaEsConfigId: CRM_META_ES_CONFIG_ID,
    metaMessengerConfigId: CRM_META_MESSENGER_CONFIG_ID,
    embeddedSignupConfigured:
      CRM_META_APP_ID.length > 0 && CRM_META_ES_CONFIG_ID.length > 0,
    messengerLoginConfigured:
      CRM_META_APP_ID.length > 0 && CRM_META_MESSENGER_CONFIG_ID.length > 0,
    instagramLoginConfigured:
      (process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID?.trim() || "").length > 0,
    instagramAppId: process.env.NEXT_PUBLIC_INSTAGRAM_APP_ID?.trim() || "",
  });
}
