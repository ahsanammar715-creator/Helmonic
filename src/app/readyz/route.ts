import { NextResponse } from "next/server";

import { getReadiness } from "@/lib/server/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await getReadiness();

  return NextResponse.json(
    {
      status: readiness.ok ? "ready" : "not-ready",
      checkedAt: readiness.checkedAt,
    },
    {
    status: readiness.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
    },
  );
}
