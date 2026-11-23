import { NextResponse } from "next/server";

import { getRuntimeConfig, getUploadConfigurationErrors } from "@/lib/server/config";
import {
  ConsultRepositoryError,
  getSessionDocument,
} from "@/lib/server/consult-repository";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: RouteContext<"/api/consult/documents/[documentId]/status">,
) {
  const requestId = crypto.randomUUID();
  const config = getRuntimeConfig();
  if (getUploadConfigurationErrors(config).length > 0) {
    return NextResponse.json(
      { error: "Private document ingestion is not enabled in this deployment.", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const actor = getAuthenticatedActor(request);
  if (!actor) {
    return NextResponse.json(
      { error: "Sign in to view document status.", requestId },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { documentId } = await context.params;
  if (!uuidPattern.test(documentId)) {
    return NextResponse.json(
      { error: "The document identifier is invalid.", requestId },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return NextResponse.json(
      { document: await getSessionDocument(config, { documentId, ownerObjectId: actor.objectId }), requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConsultRepositoryError && error.code === "not-found") {
      return NextResponse.json(
        { error: "The document was not found.", requestId },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
