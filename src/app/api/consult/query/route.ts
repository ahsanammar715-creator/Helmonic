import { NextResponse } from "next/server";

import type {
  ConsultErrorResponse,
  ConsultQueryResponse,
} from "@/lib/consult/types";
import {
  getQueryConfigurationErrors,
  getRuntimeConfig,
} from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumQuestionLength = 1_200;

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
    const { searchConsultEvidence } = await import("@/lib/server/search");
    const citations = await searchConsultEvidence(trimmedQuestion, requestId, config);

    if (citations.length === 0) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations: [],
        mode: "no-evidence",
        requestId,
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    if (!config.model.endpoint || !config.model.deployment) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations,
        mode: "retrieval-only",
        requestId,
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    const { createGroundedAnswer } = await import("@/lib/server/model");
    const answer = await createGroundedAnswer(trimmedQuestion, citations, requestId, config);
    const response: ConsultQueryResponse = {
      answer,
      citations,
      mode: "generated",
      requestId,
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
