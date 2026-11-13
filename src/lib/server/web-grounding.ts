import "server-only";

import {
  buildSafePublicWebQuery,
  parsePublicWebCitations,
  type WebResponsePayload,
} from "@/lib/consult/web-grounding-policy";
import type { ConsultCitation } from "@/lib/consult/types";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import { azureRequestError } from "@/lib/server/azure-request-error";
import type { RuntimeConfig } from "@/lib/server/config";

export async function searchPublicWebEvidence(input: {
  question: string;
  requestId: string;
  config: RuntimeConfig;
}): Promise<{ status: "used" | "privacy-skipped"; citations: ConsultCitation[] }> {
  const safeQuery = buildSafePublicWebQuery(input.question);
  if (!safeQuery) return { status: "privacy-skipped", citations: [] };
  const { endpoint, deployment } = input.config.model;
  if (!endpoint || !deployment) throw new Error("Azure model is not configured for web grounding");

  const token = await getAzureAccessToken("https://ai.azure.com/.default");
  const webTool: Record<string, unknown> = {
    type: "web_search",
    user_location: {
      type: "approximate",
      country: "IE",
      city: "Dublin",
      region: "Leinster",
      timezone: "Europe/Dublin",
    },
  };
  if (input.config.webGrounding.allowedDomains.length > 0) {
    webTool.filters = { allowed_domains: input.config.webGrounding.allowedDomains };
  }

  const response = await fetch(`${endpoint}/openai/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-ms-client-request-id": input.requestId,
    },
    body: JSON.stringify({
      model: deployment,
      reasoning: { effort: "low" },
      tools: [webTool],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 900,
      input:
        `Search the current public web for authoritative, preferably official, sources relevant to this public technical query: ${safeQuery}. ` +
        "Return a concise evidence summary with inline URL citations. Do not speculate about or request any private project, client, person, address, date, measurement or correspondence detail.",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(input.config.webGrounding.timeoutMilliseconds),
  });

  if (!response.ok) {
    throw await azureRequestError(response, {
      service: "Azure OpenAI web search",
      stage: "public-web-grounding",
    });
  }

  const payload = (await response.json()) as WebResponsePayload;
  const citations = parsePublicWebCitations(payload, {
    maximumSources: input.config.webGrounding.maximumSources,
    retrievedAt: new Date().toISOString(),
  });
  if (citations.length === 0) {
    throw new Error("Public web grounding returned no verifiable URL citations");
  }
  return { status: "used", citations };
}
