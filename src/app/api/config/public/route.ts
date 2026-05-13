import { NextResponse } from "next/server";

import { CRM_META_APP_ID, CRM_META_ES_CONFIG_ID } from "@/lib/meta-constants";

export function GET() {
  return NextResponse.json({
    metaAppId: CRM_META_APP_ID,
    metaEsConfigId: CRM_META_ES_CONFIG_ID,
    embeddedSignupConfigured:
      CRM_META_APP_ID.length > 0 && CRM_META_ES_CONFIG_ID.length > 0,
  });
}
