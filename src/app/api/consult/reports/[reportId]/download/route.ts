import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";
import { getAuthenticatedActor } from "@/lib/server/identity";
import { readReportBlob } from "@/lib/server/report-output-blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ reportId: string }> }) {
  const requestId = crypto.randomUUID();
  const actor = getAuthenticatedActor(request);
  if (!actor) return NextResponse.json({ error: "Sign in to download a report.", requestId }, { status: 401 });
  const { reportId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
    return NextResponse.json({ error: "Report not found.", requestId }, { status: 404 });
  }
  const config = getRuntimeConfig();
  if (!config.enabled || !config.reportGeneration.enabled) {
    return NextResponse.json({ error: "Report generation is not configured.", requestId }, { status: 503 });
  }
  try {
    const prefix = `${actor.objectId}/${reportId}`;
    await readReportBlob({ config, blobName: `${prefix}/manifest.json`, requestId });
    const report = await readReportBlob({ config, blobName: `${prefix}/report.docx`, requestId });
    return new NextResponse(report.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="helmonic-report-${reportId}.docx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Report not found.", requestId }, { status: 404 });
  }
}
