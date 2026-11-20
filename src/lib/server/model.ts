import "server-only";

import {
  buildEvidenceOnlyAnswer,
  buildConsultSystemPrompt,
  framePublicWebEvidence,
  NO_DOCUMENT_EVIDENCE_NOTICE,
  stopsAtEvidenceGap,
  validateExperienceAnswer,
  validateDocumentAnswerCitations,
} from "@/lib/consult/model-policy";
import {
  filterUncitedAnswerClaims,
  filterUnsupportedAnswerClaims,
} from "@/lib/consult/claim-evidence-policy";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import { azureRequestError } from "@/lib/server/azure-request-error";
import { verifyClaimEvidenceSupport } from "@/lib/server/claim-evidence-audit";
import type { RuntimeConfig } from "@/lib/server/config";
import {
  ModelGatewayValidationError,
  type ConsultModelGateway,
  type DocumentModelRequest,
} from "@/lib/server/model-gateway";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
};

type GeneratedAnswer = {
  answer: string;
  usage?: ChatCompletionResponse["usage"];
};

function buildEvidence(citations: DocumentModelRequest["evidence"]) {
  if (citations.length === 0) return "No permitted document evidence was retrieved.";

  return citations
    .map((citation, index) => {
      const marker = citation.marker ?? `D${index + 1}`;
      const location = [
        citation.section,
        citation.pageNumber ? `page ${citation.pageNumber}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");

      return `[${marker}] ${citation.title}${location ? ` (${location})` : ""}\n${
        citation.excerpt
      }`;
    })
    .join("\n\n");
}

async function requestGeneratedAnswer(input: {
  requestId: string;
  systemPrompt: string;
  userPrompt: string;
  token: string;
  config: RuntimeConfig;
}) {
  const response = await fetch(
    `${input.config.model.endpoint}/openai/deployments/${encodeURIComponent(
      input.config.model.deployment ?? "",
    )}/chat/completions?api-version=${encodeURIComponent(input.config.model.apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": input.requestId,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        reasoning_effort: input.config.model.reasoningEffort,
        verbosity: "low",
        max_completion_tokens: input.config.model.maximumCompletionTokens,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(input.config.model.timeoutMilliseconds),
    },
  );

  if (!response.ok) {
    throw await azureRequestError(response, {
      service: "Azure OpenAI",
      stage: "model",
    });
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const answer = payload.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("Azure model returned an empty answer");
  return { answer, usage: payload.usage } satisfies GeneratedAnswer;
}

function buildAnswerRepairPrompt(input: {
  request: DocumentModelRequest;
  failedAnswer: string;
  reason: string;
}) {
  const generalKnowledgeInstruction = input.request.allowGeneralKnowledge
    ? "If the retrieved passages do not directly support a necessary part of the answer, answer that part from professional general knowledge in a separate paragraph ending [G1], [G2], and so on. Do not attach a retrieved-evidence marker to a claim that its excerpt does not support."
    : "Do not add facts from general knowledge; identify any remaining evidence gap instead.";

  return `Rewrite the draft into a complete consultant-style answer to the user's arbitrary question. This is a general question-answering system, not a fixed-question template. The previous draft failed the evidence gate for this reason: ${input.reason}\n\n${generalKnowledgeInstruction}\n\nEvery factual paragraph must end with its applicable marker. Use [D#], [S#], [B#], [A#], [E#], or [W#] only for claims directly stated or necessarily entailed by that exact excerpt. Keep public-web claims in separate paragraphs explicitly described as current public-web evidence. Do not mention this repair, the failed draft, hidden source identities, or the validation process. Return only the rewritten answer.\n\nQuestion:\n${input.request.question}\n\nPermitted evidence:\n${buildEvidence(input.request.evidence)}\n\nFailed draft:\n${input.failedAnswer}`;
}

function buildProfessionalCompletionPrompt(question: string) {
  return `Answer the user's question fully as a practising acoustic consultant using professional technical knowledge. Give the direct answer first, then the reasoning, practical application and any important limitations. This is the final completeness lane because the retrieved excerpts were partial, tangential or could not support the whole answer.

Do not quote, cite or infer any retrieved document, project, client, address, correspondence, measurement result, current legal requirement or current standard clause. Do not use [D#], [S#], [B#], [A#], [E#] or [W#] markers. If the question depends on unavailable project facts, answer the general technical part and clearly list the project inputs needed rather than inventing them. Do not lead with a complaint about insufficient evidence and do not reduce the response to a caveat. Return a complete, natural consultant answer; disclosure markers are added by the server.

Question:
${question}`;
}

function markProfessionalCompletion(answer: string, hasRetrievedEvidence: boolean) {
  const cleaned = answer
    .replace(NO_DOCUMENT_EVIDENCE_NOTICE, "")
    .split(/\n\s*\n/g)
    .map((block) => block.replace(/\[[DSBAEWG]\d+\]/g, "").trim())
    .filter(Boolean);
  const blocks: string[] = [];
  let markerNumber = 1;

  if (!hasRetrievedEvidence) {
    blocks.push(`${NO_DOCUMENT_EVIDENCE_NOTICE} [G${markerNumber}]`);
    markerNumber += 1;
  }
  for (const block of cleaned) {
    blocks.push(`${block} [G${markerNumber}]`);
    markerNumber += 1;
  }
  return blocks.join("\n\n");
}

async function createDocumentAnswer(
  request: DocumentModelRequest,
  config: RuntimeConfig,
) {
  if (!config.model.endpoint || !config.model.deployment) {
    throw new Error("Azure model is not configured");
  }

  const token = await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
  const systemPrompt = buildConsultSystemPrompt({
    profile: config.profile,
    allowGeneralKnowledge: request.allowGeneralKnowledge,
    experienceMode: request.experienceMode,
  });
  const initial = await requestGeneratedAnswer({
    requestId: request.requestId,
    systemPrompt,
    userPrompt: `Question:\n${request.question}\n\nEvidence:\n${buildEvidence(request.evidence)}`,
    token,
    config,
  });
  const evidenceOnlyFallback = (reason: string) => {
    const fallback = buildEvidenceOnlyAnswer(request.evidence);
    if (!fallback) throw new ModelGatewayValidationError(reason);

    const fallbackValidation = validateDocumentAnswerCitations(fallback, request.evidence, {
      allowGeneralKnowledge: request.allowGeneralKnowledge,
    });
    if (!fallbackValidation.valid) {
      throw new ModelGatewayValidationError(fallbackValidation.errors.join(" "));
    }
    console.warn("Helmonic released deterministic evidence excerpts after generated prose failed", {
      requestId: request.requestId,
      reason,
      citationMarkers: fallbackValidation.markers,
    });
    return fallback;
  };

  const reviewAnswer = async (candidate: string) => {
    let answer = framePublicWebEvidence(candidate);
    let validation = validateDocumentAnswerCitations(answer, request.evidence, {
      allowGeneralKnowledge: request.allowGeneralKnowledge,
    });
    if (!validation.valid) return { reason: validation.errors.join(" ") };

    if (request.experienceMode) {
      const experienceValidation = validateExperienceAnswer(answer, request.evidence);
      if (!experienceValidation.valid) {
        return { reason: experienceValidation.errors.join(" ") };
      }
    }

    const citationRepair = filterUncitedAnswerClaims(answer, request.allowGeneralKnowledge);
    if (citationRepair.removedClaimCount > 0) {
      if (!citationRepair.answer) {
        return { reason: "Every generated claim lacked a permitted evidence marker." };
      }
      answer = citationRepair.answer;
      validation = validateDocumentAnswerCitations(answer, request.evidence, {
        allowGeneralKnowledge: request.allowGeneralKnowledge,
      });
      if (!validation.valid) return { reason: validation.errors.join(" ") };
      console.warn("Helmonic removed uncited answer prose and retained cited content", {
        requestId: request.requestId,
        removedClaimCount: citationRepair.removedClaimCount,
      });
    }

    if (request.allowGeneralKnowledge && stopsAtEvidenceGap(answer)) {
      return {
        reason:
          "The draft stops at an evidence limitation instead of completing the general technical answer from disclosed professional knowledge.",
      };
    }

    let audit;
    try {
      audit = await verifyClaimEvidenceSupport({
        requestId: request.requestId,
        answer,
        citations: request.evidence,
        allowGeneralKnowledge: request.allowGeneralKnowledge,
        config,
        unsupportedClaimPolicy: "return",
      });
    } catch (error) {
      if (error instanceof ModelGatewayValidationError) {
        return { reason: error.message };
      }
      throw error;
    }
    if (audit && audit.unsupportedClaimIds.length > 0) {
      const repaired = filterUnsupportedAnswerClaims(answer, audit.unsupportedClaimIds);
      if (!repaired.answer) {
        return { reason: "Every generated claim exceeded its cited excerpts." };
      }
      answer = repaired.answer;
      validation = validateDocumentAnswerCitations(answer, request.evidence, {
        allowGeneralKnowledge: request.allowGeneralKnowledge,
      });
      if (!validation.valid) return { reason: validation.errors.join(" ") };
      if (request.experienceMode) {
        const experienceValidation = validateExperienceAnswer(answer, request.evidence);
        if (!experienceValidation.valid) {
          return { reason: experienceValidation.errors.join(" ") };
        }
      }
      console.warn("Helmonic removed unsupported answer claims and retained verified claims", {
        requestId: request.requestId,
        unsupportedClaimIds: audit.unsupportedClaimIds,
        removedClaimCount: repaired.removedClaimCount,
      });
    }
    return { answer, validation };
  };

  let reviewed = await reviewAnswer(initial.answer);
  let repairUsage: ChatCompletionResponse["usage"] | undefined;
  let completionUsage: ChatCompletionResponse["usage"] | undefined;
  if (!reviewed.answer) {
    const firstFailure = reviewed.reason ?? "The generated answer failed validation.";
    console.warn("Helmonic is rewriting generated prose through the bounded evidence gate", {
      requestId: request.requestId,
      reason: firstFailure,
    });
    const repaired = await requestGeneratedAnswer({
      requestId: request.requestId,
      systemPrompt,
      userPrompt: buildAnswerRepairPrompt({
        request,
        failedAnswer: initial.answer,
        reason: firstFailure,
      }),
      token,
      config,
    });
    repairUsage = repaired.usage;
    reviewed = await reviewAnswer(repaired.answer);
    if (!reviewed.answer) {
      if (!request.allowGeneralKnowledge) {
        return evidenceOnlyFallback(reviewed.reason ?? firstFailure);
      }

      console.warn("Helmonic is completing the answer through the professional-knowledge lane", {
        requestId: request.requestId,
        reason: reviewed.reason ?? firstFailure,
      });
      const completion = await requestGeneratedAnswer({
        requestId: request.requestId,
        systemPrompt:
          "You are Helmonic Consult, an expert acoustic consultant. Be technically accurate, useful and explicit about uncertainty. Never invent private or project-specific facts.",
        userPrompt: buildProfessionalCompletionPrompt(request.question),
        token,
        config,
      });
      completionUsage = completion.usage;
      reviewed = await reviewAnswer(
        markProfessionalCompletion(completion.answer, request.evidence.length > 0),
      );
      if (!reviewed.answer) {
        throw new ModelGatewayValidationError(
          reviewed.reason ?? "The professional completion answer failed validation.",
        );
      }
    }
  }

  const answer = reviewed.answer;
  const validation = reviewed.validation;
  if (!validation) throw new ModelGatewayValidationError("The reviewed answer was not validated.");

  console.info("Helmonic model usage", {
    requestId: request.requestId,
    deployment: config.model.deployment,
    promptTokens: initial.usage?.prompt_tokens,
    completionTokens: initial.usage?.completion_tokens,
    reasoningTokens: initial.usage?.completion_tokens_details?.reasoning_tokens,
    repairPromptTokens: repairUsage?.prompt_tokens,
    repairCompletionTokens: repairUsage?.completion_tokens,
    professionalCompletionPromptTokens: completionUsage?.prompt_tokens,
    professionalCompletionTokens: completionUsage?.completion_tokens,
    citationMarkers: validation.markers,
    generalKnowledgeMarkers: validation.generalMarkers,
  });

  return answer;
}

export function createConsultModelGateway(config: RuntimeConfig): ConsultModelGateway {
  return {
    createAnswer: (request) => createDocumentAnswer(request, config),
  };
}
