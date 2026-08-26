import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = getRuntimeConfig();
  const userId = typeof process.getuid === "function" ? process.getuid() : null;

  return NextResponse.json(
    {
      status: "healthy",
      service: "helmonic-consult",
      version: config.appVersion,
      runtime: {
        userId,
        nonRoot: userId === null ? null : userId !== 0,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
