import { NextResponse } from "next/server";

import type {
  ConsultErrorResponse,
  ConsultQueryResponse,
} from "@/lib/consult/types";
import {
  getQueryConfigurationErrors,
  getRuntimeConfig,
} from "@/lib/server/config";
import { getAuthenticatedActor } from "@/lib/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumQuestionLength = 1_200;

function generalContext(
  requested: boolean,
  config: ReturnType<typeof getRuntimeConfig>,
): ConsultQueryResponse["generalContext"] {
  if (!requested) return { status: "disabled", text: null, citations: [] };
  if (
    !config.phase1b.generalContextEnabled ||
    !config.phase1b.generalSearchIndex ||
    !config.model.endpoint ||
    !config.model.deployment
  ) {
    return { status: "unavailable", text: null, citations: [] };
  }

  // Activation deliberately remains fail-closed until a curated general index and
  // approved model are deployed and the gateway implementation is validated.
  return { status: "unavailable", text: null, citations: [] };
}

function errorResponse(message: string, requestId: string, status: number) {
  return NextResponse.json<ConsultErrorResponse>(
    { error: message, requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const config = getRuntimeConfig();

  if (!config.enabled) {
    const response: ConsultQueryResponse = {
      answer: null,
      citations: [],
      mode: "not-configured",
      requestId,
      documentAnswer: { status: "not-configured", text: null, citations: [] },
      generalContext: { status: "disabled", text: null, citations: [] },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  }

  const contentLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return errorResponse("The Consult request is too large.", requestId, 413);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Send a valid JSON request.", requestId, 400);
  }

  const question =
    typeof body === "object" && body !== null && "question" in body
      ? (body as { question?: unknown }).question
      : undefined;
  const includeGeneralContext =
    typeof body === "object" && body !== null && "includeGeneralContext" in body
      ? (body as { includeGeneralContext?: unknown }).includeGeneralContext === true
      : false;
  const conversationId =
    typeof body === "object" && body !== null && "conversationId" in body
      ? (body as { conversationId?: unknown }).conversationId
      : undefined;
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        conversationId,
      ))
  ) {
    return errorResponse("The conversation identifier is invalid.", requestId, 400);
  }

  if (typeof question !== "string" || !question.trim()) {
    return errorResponse("Enter a question for Helmonic Consult.", requestId, 400);
  }

  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length > maximumQuestionLength) {
    return errorResponse(
      `Keep the question under ${maximumQuestionLength.toLocaleString()} characters.`,
      requestId,
      400,
    );
  }

  const configurationErrors = getQueryConfigurationErrors(config);

  if (configurationErrors.length > 0) {
    console.error("Helmonic Consult runtime configuration is incomplete", {
      requestId,
      missing: configurationErrors,
    });
    return errorResponse(
      "The Phase 1A Consult runtime is not fully configured yet.",
      requestId,
      503,
    );
  }

  try {
    const { searchConsultEvidence, searchSessionEvidence } = await import("@/lib/server/search");
    const actor = conversationId ? getAuthenticatedActor(request) : null;
    if (conversationId && !actor) {
      return errorResponse("Sign in to query conversation attachments.", requestId, 401);
    }
    const [controlledCitations, attachmentCitations] = await Promise.all([
      searchConsultEvidence(trimmedQuestion, requestId, config),
      conversationId && actor && config.phase1b.uploadsEnabled
        ? searchSessionEvidence(
            trimmedQuestion,
            actor.objectId,
            conversationId,
            requestId,
            config,
          )
        : Promise.resolve([]),
    ]);
    const citations = [...controlledCitations, ...attachmentCitations];

    if (citations.length === 0) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations: [],
        mode: "no-evidence",
        requestId,
        documentAnswer: { status: "no-evidence", text: null, citations: [] },
        generalContext: generalContext(includeGeneralContext, config),
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    if (!config.model.endpoint || !config.model.deployment) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations,
        mode: "retrieval-only",
        requestId,
        documentAnswer: { status: "retrieval-only", text: null, citations },
        generalContext: generalContext(includeGeneralContext, config),
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    const { createConsultModelGateway } = await import("@/lib/server/model");
    const gateway = createConsultModelGateway(config);
    const answer = await gateway.createDocumentAnswer({
      requestId,
      question: trimmedQuestion,
      evidence: citations,
    });
    const response: ConsultQueryResponse = {
      answer,
      citations,
      mode: "generated",
      requestId,
      documentAnswer: { status: "generated", text: answer, citations },
      generalContext: generalContext(includeGeneralContext, config),
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Helmonic Consult request failed", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return errorResponse(
      "Helmonic could not complete this request. Please retry with the prepared demo question.",
      requestId,
      502,
    );
  }
}
