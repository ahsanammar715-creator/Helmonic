import { NextResponse } from "next/server";

import type {
  ConsultCitation,
  ConsultErrorResponse,
  ConsultQueryResponse,
} from "@/lib/consult/types";
import { isAttachmentDirectedQuestion } from "@/lib/consult/attachment-query-policy";
import {
  actorMayReadRestrictedEmailEvidence,
  emailEvidenceConfigurationErrors,
} from "@/lib/consult/email-evidence-policy";
import { toPublicExperienceCitations } from "@/lib/consult/experience-evidence-policy";
import {
  getQueryConfigurationErrors,
  getRuntimeConfig,
} from "@/lib/server/config";
import {
  retryTransientAzureOperation,
  safeAzureRequestDiagnostic,
} from "@/lib/server/azure-request-error";
import { getAuthenticatedActor } from "@/lib/server/identity";
import { ModelGatewayValidationError } from "@/lib/server/model-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumQuestionLength = 1_200;
const maximumAttachmentDocumentIds = 10;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generalKnowledgeEnabled(config: ReturnType<typeof getRuntimeConfig>): boolean {
  return Boolean(config.model.endpoint && config.model.deployment);
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
  const attachmentDocumentIdsValue =
    typeof body === "object" && body !== null && "attachmentDocumentIds" in body
      ? (body as { attachmentDocumentIds?: unknown }).attachmentDocumentIds
      : [];
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || !uuidPattern.test(conversationId))
  ) {
    return errorResponse("The conversation identifier is invalid.", requestId, 400);
  }
  if (
    !Array.isArray(attachmentDocumentIdsValue) ||
    attachmentDocumentIdsValue.length > maximumAttachmentDocumentIds ||
    attachmentDocumentIdsValue.some(
      (documentId) => typeof documentId !== "string" || !uuidPattern.test(documentId),
    )
  ) {
    return errorResponse("The attachment selection is invalid.", requestId, 400);
  }
  const attachmentDocumentIds = [...new Set(attachmentDocumentIdsValue as string[])];
  if (attachmentDocumentIds.length > 0 && !conversationId) {
    return errorResponse("Attachment questions require a conversation.", requestId, 400);
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
  const attachmentDirected = Boolean(
    conversationId && isAttachmentDirectedQuestion(trimmedQuestion),
  );
  const scopedAttachmentDocumentIds =
    attachmentDirected && attachmentDocumentIds.length > 0
      ? [attachmentDocumentIds.at(-1)!]
      : attachmentDocumentIds;
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
      searchPromotedKnowledgeEvidence,
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
      promotedKnowledgeCitations,
      attachmentCitations,
      emailCitations,
      experienceCitations,
      webEvidence,
    ] = await Promise.all([
      retryTransientAzureOperation(
        () => searchConsultEvidence(trimmedQuestion, requestId, config),
        { requestId, operation: "controlled-retrieval" },
      ),
      actor && config.phase1b.uploadsEnabled
        ? retryTransientAzureOperation(
            () => searchPromotedKnowledgeEvidence(trimmedQuestion, requestId, config),
            { requestId, operation: "promoted-knowledge-retrieval" },
          )
        : Promise.resolve([]),
      conversationId && actor && config.phase1b.uploadsEnabled
        ? retryTransientAzureOperation(
            () =>
              searchSessionEvidence(
                trimmedQuestion,
                actor.objectId,
                conversationId,
                requestId,
                config,
                {
                  documentIds: scopedAttachmentDocumentIds,
                  overview: attachmentDirected,
                },
              ),
            { requestId, operation: "session-retrieval" },
          )
        : Promise.resolve([]),
      includeEmailEvidence && actor
        ? retryTransientAzureOperation(
            () => searchRestrictedEmailEvidence(trimmedQuestion, actor, requestId, config),
            { requestId, operation: "restricted-email-retrieval" },
          )
        : Promise.resolve([]),
      includeDeidentifiedExperience && actor
        ? retryTransientAzureOperation(
            () => searchDeidentifiedExperienceEvidence(trimmedQuestion, actor, requestId, config),
            { requestId, operation: "deidentified-experience-retrieval" },
          )
        : Promise.resolve([]),
      includeWebEvidence
        ? import("@/lib/server/web-grounding")
            .then(({ searchPublicWebEvidence }) =>
              searchPublicWebEvidence({ question: trimmedQuestion, requestId, config }),
            )
            .catch((error: unknown) => {
              console.warn(
                "Helmonic public-web retrieval unavailable; continuing with permitted internal evidence",
                {
                  requestId,
                  errorType: error instanceof Error ? error.name : "UnknownError",
                  message: error instanceof Error ? error.message : "unknown",
                  azureDiagnostic: safeAzureRequestDiagnostic(error),
                },
              );
              return { status: "unavailable" as const, citations: [] };
            })
        : Promise.resolve({ status: "not-requested" as const, citations: [] }),
    ]);
    const citationCounters = { D: 0, S: 0, B: 0, A: 0, E: 0, W: 0 };
    const orderedCitations = [
      ...(attachmentDirected ? attachmentCitations : controlledCitations),
      ...(attachmentDirected ? controlledCitations : promotedKnowledgeCitations),
      ...(attachmentDirected ? promotedKnowledgeCitations : attachmentCitations),
      ...emailCitations,
      ...experienceCitations,
      ...webEvidence.citations,
    ];
    const seenCitationIds = new Set<string>();
    const citations = orderedCitations.filter((citation) => {
      if (seenCitationIds.has(citation.id)) return false;
      seenCitationIds.add(citation.id);
      return true;
    }).map((citation) => {
      const namespace = citation.citationNamespace;
      if (!namespace) return citation;
      citationCounters[namespace] += 1;
      return {
        ...citation,
        marker: `${namespace}${citationCounters[namespace]}` as ConsultCitation["marker"],
      };
    });
    // Professional knowledge is an automatic completion lane. Retrieved evidence
    // remains authoritative for project facts, but a partial or tangential search
    // result must never reduce a normal technical question to an evidence caveat.
    const allowGeneralKnowledge = generalKnowledgeEnabled(config);
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
        attachmentFocus: attachmentDirected && attachmentCitations.length > 0,
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
      "Helmonic could not complete this request. Please retry the question.",
      requestId,
      502,
    );
  }
}
