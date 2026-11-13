import { NextResponse } from "next/server";

import type {
  ConsultErrorResponse,
  ConsultQueryResponse,
} from "@/lib/consult/types";
import {
  actorMayReadRestrictedEmailEvidence,
  emailEvidenceConfigurationErrors,
} from "@/lib/consult/email-evidence-policy";
import { toPublicExperienceCitations } from "@/lib/consult/experience-evidence-policy";
import {
  getQueryConfigurationErrors,
  getRuntimeConfig,
} from "@/lib/server/config";
import { safeAzureRequestDiagnostic } from "@/lib/server/azure-request-error";
import { getAuthenticatedActor } from "@/lib/server/identity";
import { ModelGatewayValidationError } from "@/lib/server/model-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumQuestionLength = 1_200;

function generalKnowledgeEnabled(
  requested: boolean,
  config: ReturnType<typeof getRuntimeConfig>,
): boolean {
  return Boolean(
    requested &&
      config.phase1b.generalContextEnabled &&
      config.model.endpoint &&
      config.model.deployment,
  );
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
      generalKnowledgeUsed: false,
      webEvidenceStatus: "not-requested",
      documentAnswer: { status: "not-configured", text: null, citations: [] },
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
  const includeEmailEvidence =
    typeof body === "object" && body !== null && "includeEmailEvidence" in body
      ? (body as { includeEmailEvidence?: unknown }).includeEmailEvidence === true
      : false;
  const includeDeidentifiedExperience =
    typeof body === "object" && body !== null && "includeDeidentifiedExperience" in body
      ? (body as { includeDeidentifiedExperience?: unknown }).includeDeidentifiedExperience === true
      : false;
  // Public-web evidence is a standard consultant-answer lane when enabled for the
  // deployment. The privacy-safe query builder can still skip web access for
  // private-only questions without transmitting names, projects or correspondence.
  const includeWebEvidence = config.webGrounding.enabled;
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
  if (includeEmailEvidence && includeDeidentifiedExperience) {
    return errorResponse(
      "Choose either restricted email evidence or de-identified project experience, not both.",
      requestId,
      400,
    );
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
    const {
      searchConsultEvidence,
      searchSessionEvidence,
      searchRestrictedEmailEvidence,
      searchDeidentifiedExperienceEvidence,
    } = await import("@/lib/server/search");
    const actor =
      conversationId || includeEmailEvidence || includeDeidentifiedExperience || includeWebEvidence
        ? getAuthenticatedActor(request)
        : null;
    if (
      (conversationId ||
        includeEmailEvidence ||
        includeDeidentifiedExperience ||
        includeWebEvidence) &&
      !actor
    ) {
      return errorResponse(
        "Sign in to query uploaded, restricted, de-identified, or current public-web evidence.",
        requestId,
        401,
      );
    }
    if (includeEmailEvidence || includeDeidentifiedExperience) {
      const emailConfigurationErrors = emailEvidenceConfigurationErrors(config);
      if (emailConfigurationErrors.length > 0) {
        console.error("Restricted email evidence configuration is incomplete", {
          requestId,
          missing: emailConfigurationErrors,
        });
        return errorResponse("Restricted email evidence is not available.", requestId, 503);
      }
      if (includeEmailEvidence && !actorMayReadRestrictedEmailEvidence(actor, config)) {
        return errorResponse("You are not permitted to query restricted email evidence.", requestId, 403);
      }
    }
    const [
      controlledCitations,
      attachmentCitations,
      emailCitations,
      experienceCitations,
      webEvidence,
    ] = await Promise.all([
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
      includeEmailEvidence && actor
        ? searchRestrictedEmailEvidence(trimmedQuestion, actor, requestId, config)
        : Promise.resolve([]),
      includeDeidentifiedExperience && actor
        ? searchDeidentifiedExperienceEvidence(trimmedQuestion, actor, requestId, config)
        : Promise.resolve([]),
      includeWebEvidence
        ? import("@/lib/server/web-grounding").then(({ searchPublicWebEvidence }) =>
            searchPublicWebEvidence({ question: trimmedQuestion, requestId, config }),
          )
        : Promise.resolve({ status: "not-requested" as const, citations: [] }),
    ]);
    const citations = [
      ...controlledCitations,
      ...attachmentCitations,
      ...emailCitations,
      ...experienceCitations,
      ...webEvidence.citations,
    ];
    const allowGeneralKnowledge = generalKnowledgeEnabled(includeGeneralContext, config);
    const publicCitations = toPublicExperienceCitations(citations);

    if (citations.length === 0 && !allowGeneralKnowledge) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations: [],
        mode: "no-evidence",
        requestId,
        generalKnowledgeUsed: false,
        webEvidenceStatus: webEvidence.status,
        documentAnswer: { status: "no-evidence", text: null, citations: [] },
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    if (!config.model.endpoint || !config.model.deployment) {
      const response: ConsultQueryResponse = {
        answer: null,
        citations: publicCitations,
        mode: "retrieval-only",
        requestId,
        generalKnowledgeUsed: false,
        webEvidenceStatus: webEvidence.status,
        documentAnswer: { status: "retrieval-only", text: null, citations: publicCitations },
      };
      return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    }

    const { createConsultModelGateway } = await import("@/lib/server/model");
    const gateway = createConsultModelGateway(config);
    let answer: string;
    try {
      answer = await gateway.createAnswer({
        requestId,
        question: trimmedQuestion,
        evidence: citations,
        allowGeneralKnowledge,
        experienceMode: includeDeidentifiedExperience,
      });
    } catch (error) {
      if (error instanceof ModelGatewayValidationError) {
        console.warn("Helmonic withheld an answer that failed claim-to-evidence validation", {
          requestId,
          message: error.message,
        });
        const response: ConsultQueryResponse = {
          answer: null,
          citations: publicCitations,
          mode: "retrieval-only",
          requestId,
          generalKnowledgeUsed: false,
          webEvidenceStatus: webEvidence.status,
          documentAnswer: { status: "retrieval-only", text: null, citations: publicCitations },
        };
        return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
      }
      throw error;
    }
    const generalKnowledgeUsed = /\[G\d+\]/.test(answer);
    const response: ConsultQueryResponse = {
      answer,
      citations: publicCitations,
      mode: "generated",
      requestId,
      generalKnowledgeUsed,
      webEvidenceStatus: webEvidence.status,
      documentAnswer: {
        status: citations.length > 0 ? "generated" : "no-evidence",
        text: citations.length > 0 ? answer : null,
        citations: publicCitations,
      },
    };

    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const azureDiagnostic = safeAzureRequestDiagnostic(error);
    console.error("Helmonic Consult request failed", {
      requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown",
      azureDiagnostic,
    });
    return errorResponse(
      "Helmonic could not complete this request. Please retry with the prepared demo question.",
      requestId,
      502,
    );
  }
}
