import { NextResponse } from "next/server";

import type { SessionDocumentUploadResponse } from "@/lib/consult/uploads";
import {
  getRuntimeConfig,
  getUploadConfigurationErrors,
} from "@/lib/server/config";
import {
  ConsultRepositoryError,
  createSessionUpload,
  markSessionUploadFailed,
  markSessionUploadQueued,
  markSessionUploadStored,
} from "@/lib/server/consult-repository";
import { getAuthenticatedActor } from "@/lib/server/identity";
import { sendSessionIngestionMessage } from "@/lib/server/service-bus";
import { uploadSessionPdf } from "@/lib/server/session-blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizeFileName(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-");
  const compact = normalized.replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return compact.slice(0, 160) || "attachment.pdf";
}

function uploadError(message: string, requestId: string, status: number) {
  return NextResponse.json(
    { error: message, requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/consult/conversations/[conversationId]/documents">,
) {
  const requestId = crypto.randomUUID();
  const config = getRuntimeConfig();
  const configurationErrors = getUploadConfigurationErrors(config);
  if (configurationErrors.length > 0) {
    return uploadError("Phase 1B document uploads are not enabled in this deployment.", requestId, 503);
  }

  const actor = getAuthenticatedActor(request);
  if (!actor) return uploadError("Sign in to attach a document.", requestId, 401);

  const { conversationId } = await context.params;
  if (!uuidPattern.test(conversationId)) {
    return uploadError("The conversation identifier is invalid.", requestId, 400);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf") {
    return uploadError("Only PDF attachments are accepted in this phase.", requestId, 415);
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!Number.isSafeInteger(contentLength) || contentLength < 5) {
    return uploadError("The PDF is empty or has no valid content length.", requestId, 400);
  }
  if (contentLength > config.phase1b.maximumUploadBytes) {
    return uploadError("The PDF exceeds the configured upload limit.", requestId, 413);
  }
  if (!request.body) return uploadError("The PDF body is missing.", requestId, 400);

  let originalName: string;
  try {
    originalName = decodeURIComponent(request.headers.get("x-helmonic-file-name") ?? "");
  } catch {
    return uploadError("The attachment filename is invalid.", requestId, 400);
  }
  const displayName = sanitizeFileName(originalName);
  if (!displayName.toLowerCase().endsWith(".pdf")) {
    return uploadError("The attachment filename must end in .pdf.", requestId, 415);
  }

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.phase1b.uploadRetentionDays * 86_400_000);
  const blobName = `${actor.objectId}/${conversationId}/${documentId}/${displayName}`;

  try {
    await createSessionUpload(config, {
      documentId,
      versionId,
      jobId,
      conversationId,
      ownerObjectId: actor.objectId,
      displayName,
      blobContainer: config.phase1b.sessionBlobContainer,
      blobName,
      indexName: config.phase1b.sessionSearchIndex!,
      sizeBytes: contentLength,
      expiresAt,
      correlationId: requestId,
    });

    const stored = await uploadSessionPdf(
      config,
      blobName,
      contentLength,
      request.body,
      requestId,
    );
    await markSessionUploadStored(config, documentId, jobId, stored.contentHash);
    await sendSessionIngestionMessage(config, {
      version: 1,
      operation: "ingest-session-document",
      jobId,
      documentId,
      documentVersionId: versionId,
      conversationId,
      ownerObjectId: actor.objectId,
      blobContainer: config.phase1b.sessionBlobContainer,
      blobName,
      sourceUri: stored.sourceUri,
      contentHash: stored.contentHash,
      displayName,
      targetIndex: config.phase1b.sessionSearchIndex!,
      expiresAt: expiresAt.toISOString(),
      correlationId: requestId,
    });
    await markSessionUploadQueued(config, documentId, jobId);

    const response: SessionDocumentUploadResponse = {
      document: {
        id: documentId,
        conversationId,
        displayName,
        state: "queued",
        sizeBytes: contentLength,
        createdAt: new Date().toISOString(),
      },
      requestId,
    };
    return NextResponse.json(response, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!(error instanceof ConsultRepositoryError && error.code === "not-found")) {
      await markSessionUploadFailed(config, documentId, jobId, "upload-or-queue-failed").catch(
        () => undefined,
      );
    }
    if (error instanceof ConsultRepositoryError && error.code === "not-found") {
      return uploadError("The conversation was not found.", requestId, 404);
    }
    console.error("Phase 1B attachment upload failed", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return uploadError("The attachment could not be stored safely.", requestId, 502);
  }
}
