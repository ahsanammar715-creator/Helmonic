import "server-only";

import {
  buildSafePublicWebQuery,
  parsePublicWebCitations,
  type WebResponsePayload,
} from "@/lib/consult/web-grounding-policy";
import type { ConsultCitation } from "@/lib/consult/types";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import {
  azureRequestError,
  azureRetryDelayMilliseconds,
} from "@/lib/server/azure-request-error";
import type { RuntimeConfig } from "@/lib/server/config";

type PublicWebResult = {
  status: "used" | "privacy-skipped";
  citations: ConsultCitation[];
};

const publicWebCache = new Map<
  string,
  { expiresAt: number; result: PublicWebResult }
>();
const publicWebInFlight = new Map<string, Promise<PublicWebResult>>();
const publicWebCacheMilliseconds = 15 * 60 * 1_000;

export async function searchPublicWebEvidence(input: {
  question: string;
  requestId: string;
  config: RuntimeConfig;
}): Promise<PublicWebResult> {
  const safeQuery = buildSafePublicWebQuery(input.question);
  if (!safeQuery) return { status: "privacy-skipped", citations: [] };
  const cached = publicWebCache.get(safeQuery);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) publicWebCache.delete(safeQuery);
  const existingRequest = publicWebInFlight.get(safeQuery);
  if (existingRequest) return existingRequest;

  const request = executePublicWebSearch({ ...input, safeQuery });
  publicWebInFlight.set(safeQuery, request);
  try {
    const result = await request;
    publicWebCache.set(safeQuery, {
      expiresAt: Date.now() + publicWebCacheMilliseconds,
      result,
    });
    return result;
  } finally {
    publicWebInFlight.delete(safeQuery);
  }
}

async function executePublicWebSearch(input: {
  safeQuery: string;
  requestId: string;
  config: RuntimeConfig;
}): Promise<PublicWebResult> {
  const { endpoint, deployment } = input.config.webGrounding;
  if (!endpoint || !deployment) throw new Error("Azure model is not configured for web grounding");

  const token = await getAzureAccessToken("https://ai.azure.com/.default");
  const webTool: Record<string, unknown> = {
    type: "web_search",
    search_context_size: "low",
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

  for (let citationAttempt = 0; citationAttempt < 2; citationAttempt += 1) {
    let response: Response | undefined;
    for (let rateAttempt = 0; rateAttempt < 2; rateAttempt += 1) {
      response = await fetch(`${endpoint}/openai/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": `${input.requestId}-web-${citationAttempt + 1}-${rateAttempt + 1}`,
      },
      body: JSON.stringify({
        model: deployment,
        tools: [webTool],
        // An eligible public consultant question must actually use the web tool.
        // Leaving this as `auto` allowed the retrieval model to occasionally
        // answer from memory, producing no traceable URL annotations. Fail-closed
        // validation then rejected the otherwise useful request.
        tool_choice: "required",
        // The web lane only produces a short evidence digest and URL citations.
        // Keep its token reservation below the deliberately small Azure rate-limit
        // ceiling used for this cost-controlled deployment.
        max_output_tokens: 500,
        input:
          `Search the current public web for authoritative, preferably official, sources relevant to this public technical query: ${input.safeQuery}. ` +
          "Return a concise evidence summary with inline URL citations. Include at least one explicit HTTPS source link in the answer. " +
          (citationAttempt === 1
            ? "The prior response contained no traceable source URL, so cite the official source URL explicitly. "
            : "") +
          "Do not speculate about or request any private project, client, person, address, date, measurement or correspondence detail.",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(input.config.webGrounding.timeoutMilliseconds),
    });

      if (response.status !== 429 || rateAttempt === 1) break;
      const retryDelayMilliseconds = azureRetryDelayMilliseconds(response, rateAttempt);
      console.warn("Helmonic public-web search throttled; retrying once", {
        requestId: input.requestId,
        retryDelayMilliseconds,
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds));
    }

    if (!response) throw new Error("The public-web search did not execute.");

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
    if (citations.length > 0) {
      return { status: "used", citations };
    }
  }

  throw new Error("Public web grounding returned no verifiable URL citations");
}
