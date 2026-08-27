import "server-only";

import { validateDocumentAnswerCitations } from "@/lib/consult/model-policy";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
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

function buildEvidence(citations: DocumentModelRequest["evidence"]) {
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

async function createDocumentAnswer(
  request: DocumentModelRequest,
  config: RuntimeConfig,
) {
  if (!config.model.endpoint || !config.model.deployment) {
    throw new Error("Azure model is not configured");
  }

  const token = await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
  const response = await fetch(
    `${config.model.endpoint}/openai/deployments/${encodeURIComponent(
      config.model.deployment,
    )}/chat/completions?api-version=${encodeURIComponent(config.model.apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": request.requestId,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              `You are Helmonic Consult for the fixed ${config.profile} evidence set. Answer only from the supplied evidence. Cite every factual paragraph with one or more supplied document markers such as [D1] or attachment markers such as [A1]. Never invent a source, clause, page, measurement, citation marker, or general-knowledge claim. If the evidence conflicts, identify the conflict and cite both sides. If it is insufficient, say so clearly and do not fill the gap from general knowledge. Keep the answer concise and practical.`,
          },
          {
            role: "user",
            content: `Question:\n${request.question}\n\nEvidence:\n${buildEvidence(request.evidence)}`,
          },
        ],
        reasoning_effort: config.model.reasoningEffort,
        verbosity: "low",
        max_completion_tokens: config.model.maximumCompletionTokens,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(config.model.timeoutMilliseconds),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure model request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const answer = payload.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error("Azure model returned an empty answer");
  }

  const validation = validateDocumentAnswerCitations(answer, request.evidence);
  if (!validation.valid) {
    throw new ModelGatewayValidationError(validation.errors.join(" "));
  }

  console.info("Helmonic model usage", {
    requestId: request.requestId,
    deployment: config.model.deployment,
    promptTokens: payload.usage?.prompt_tokens,
    completionTokens: payload.usage?.completion_tokens,
    reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
    citationMarkers: validation.markers,
  });

  return answer;
}

export function createConsultModelGateway(config: RuntimeConfig): ConsultModelGateway {
  return {
    createDocumentAnswer: (request) => createDocumentAnswer(request, config),
    createGeneralContext: async () => {
      throw new ModelGatewayValidationError(
        "General context remains disabled until its separate source pathway is approved.",
      );
    },
  };
}
