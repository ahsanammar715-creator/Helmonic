import { NextResponse } from "next/server";

import { getRuntimeConfig } from "@/lib/server/config";
import { safeAzureRequestDiagnostic } from "@/lib/server/azure-request-error";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, requestId: string, status: number) {
  return NextResponse.json({ error, requestId }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const actor = getAuthenticatedActor(request);
  if (!actor) return fail("Sign in to generate a report.", requestId, 401);
  const config = getRuntimeConfig();
  if (!config.enabled || !config.reportGeneration.enabled || !config.reportTemplate.enabled) {
    return fail("Report generation is not configured.", requestId, 503);
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > config.reportGeneration.maximumAttachmentBytes + 512_000) {
    return fail("The report request is too large.", requestId, 413);
  }
  try {
    const form = await request.formData();
    const metadata = JSON.parse(String(form.get("metadata") ?? "{}"));
    const instruction = String(form.get("instruction") ?? "").trim();
    const conversationId = String(form.get("conversationId") ?? "").trim();
    if (!instruction) return fail("Enter report instructions.", requestId, 400);
    if (conversationId && !/^[0-9a-f-]{36}$/i.test(conversationId)) {
      return fail("The conversation identifier is invalid.", requestId, 400);
    }
    const attachmentValues = form
      .getAll("attachments")
      .filter((value): value is File => value instanceof File);
    let attachmentDocumentIds: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("attachmentDocumentIds") ?? "[]")) as unknown;
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))) {
        return fail("The supplementary evidence identifiers are invalid.", requestId, 400);
      }
      attachmentDocumentIds = parsed;
    } catch {
      return fail("The supplementary evidence identifiers are invalid.", requestId, 400);
    }
    if (attachmentDocumentIds.length !== 0 && attachmentDocumentIds.length !== attachmentValues.length) {
      return fail("The supplementary evidence does not match the attached files.", requestId, 400);
    }
    if (attachmentValues.length > config.reportGeneration.maximumAttachmentCount) {
      return fail("Too many supplementary documents were attached.", requestId, 413);
    }
    const attachmentBytes = attachmentValues.reduce((total, file) => total + file.size, 0);
    if (attachmentBytes > config.reportGeneration.maximumAttachmentBytes) {
      return fail("The supplementary documents are too large.", requestId, 413);
    }
    const files = await Promise.all(
      attachmentValues
        .map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })),
    );
    const { searchReportEvidence, searchSessionEvidence } = await import("@/lib/server/search");
    const reportEvidenceQuery = [
      instruction,
      typeof metadata?.projectName === "string" ? metadata.projectName : "",
      typeof metadata?.projectNumber === "string" ? metadata.projectNumber : "",
      typeof metadata?.client === "string" ? metadata.client : "",
    ]
      .filter(Boolean)
      .join(" ");
    const [controlled, session] = await Promise.all([
      searchReportEvidence(reportEvidenceQuery, requestId, config),
      conversationId && config.phase1b.uploadsEnabled
        ? searchSessionEvidence(instruction, actor.objectId, conversationId, requestId, config)
        : Promise.resolve([]),
    ]);
    const sessionSourceIds = new Set(session.map((citation) => citation.sourceId));
    const reportFiles = files.map((file, index) => ({
      ...file,
      evidenceStatus: attachmentDocumentIds[index]
        ? sessionSourceIds.has(attachmentDocumentIds[index])
          ? "included-as-text-evidence" as const
          : "already-indexed" as const
        : "stored-only" as const,
    }));
    const { generateAndStoreReport } = await import("@/lib/server/report-generation");
    const result = await generateAndStoreReport({
      config,
      requestId,
      requestedByObjectId: actor.objectId,
      instruction,
      metadata,
      citations: [...controlled, ...session],
      files: reportFiles,
    });
    return NextResponse.json({ ...result, requestId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const azureDiagnostic = safeAzureRequestDiagnostic(error);
    const diagnostic =
      process.env.REPORT_GENERATION_DIAGNOSTICS === "true" &&
      error instanceof Error
        ? azureDiagnostic ?? (error.name === "ReportModelRequestError" ? {
            modelStatus: Number((error as Error & { status?: number }).status ?? 0),
            modelResponse: String((error as Error & { responseBody?: string }).responseBody ?? ""),
          } : undefined)
        : undefined;
    console.error("Helmonic report generation failed", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown",
      azureDiagnostic,
      diagnostic,
    });
    return NextResponse.json(
      {
        error: "Helmonic could not generate the report from the available grounded evidence.",
        requestId,
        ...(diagnostic ? { diagnostic } : {}),
      },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
