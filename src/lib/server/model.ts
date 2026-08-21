import "server-only";

import type { ConsultCitation } from "@/lib/consult/types";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function buildEvidence(citations: ConsultCitation[]) {
  return citations
    .map((citation, index) => {
      const location = [
        citation.section,
        citation.pageNumber ? `page ${citation.pageNumber}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");

      return `[${index + 1}] ${citation.title}${location ? ` (${location})` : ""}\n${
        citation.excerpt
      }`;
    })
    .join("\n\n");
}

function removeUnsupportedCitationMarkers(answer: string, citationCount: number) {
  return answer.replace(/\[(\d+)\]/g, (marker, value: string) => {
    const number = Number.parseInt(value, 10);
    return number >= 1 && number <= citationCount ? marker : "";
  });
}

export async function createGroundedAnswer(
  question: string,
  citations: ConsultCitation[],
  requestId: string,
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
        "x-ms-client-request-id": requestId,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              `You are Helmonic Consult for the fixed ${config.profile} Phase 1A demo. Answer only from the supplied evidence. If the evidence is insufficient, say so clearly. Cite factual claims with the supplied numeric markers such as [1]. Never invent a source, clause, page, measurement, or citation number. Keep the answer concise and practical.`,
          },
          {
            role: "user",
            content: `Question:\n${question}\n\nEvidence:\n${buildEvidence(citations)}`,
          },
        ],
        max_completion_tokens: 700,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
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

  const cleaned = removeUnsupportedCitationMarkers(answer, citations.length);
  return /\[\d+\]/.test(cleaned) ? cleaned : `${cleaned}\n\nRetrieved evidence: [1]`;
}
