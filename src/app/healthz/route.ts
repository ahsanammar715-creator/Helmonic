import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = getRuntimeConfig();

  return NextResponse.json(
    {
      status: "healthy",
      service: "helmonic-consult",
      version: config.appVersion,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
