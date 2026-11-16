import "server-only";

import {
  buildSafePublicWebQuery,
  parseBravePublicWebCitations,
  type BraveLlmContextPayload,
} from "@/lib/consult/web-grounding-policy";
import type { ConsultCitation } from "@/lib/consult/types";
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
      expiresAt: Date.now() + input.config.webGrounding.cacheMilliseconds,
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
  const { apiKey, endpoint } = input.config.webGrounding;
  if (!apiKey) throw new Error("Brave Search is not configured for public-web grounding");

  const url = new URL(endpoint);
  url.searchParams.set("q", input.safeQuery);
  url.searchParams.set(
    "maximum_number_of_tokens",
    String(input.config.webGrounding.maximumContextTokens),
  );
  url.searchParams.set("context_threshold_mode", "strict");

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(input.config.webGrounding.timeoutMilliseconds),
    });

    if (response.ok) break;
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 2) break;
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const retryDelayMilliseconds = Number.isFinite(retryAfterSeconds)
      ? Math.min(retryAfterSeconds * 1_000, 10_000)
      : 500 * 2 ** attempt;
    console.warn("Helmonic public-web search transient failure; retrying", {
      requestId: input.requestId,
      status: response.status,
      retryDelayMilliseconds,
    });
    await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds));
  }

  if (!response) throw new Error("The public-web search did not execute.");
  if (!response.ok) {
    const providerMessage = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 400);
    throw new Error(
      `Brave Search public-web grounding failed with HTTP ${response.status}${
        providerMessage ? `: ${providerMessage}` : ""
      }`,
    );
  }

  const payload = (await response.json()) as BraveLlmContextPayload;
  const citations = parseBravePublicWebCitations(payload, {
    maximumSources: input.config.webGrounding.maximumSources,
    retrievedAt: new Date().toISOString(),
    allowedDomains: input.config.webGrounding.allowedDomains,
  });
  if (citations.length === 0) {
    throw new Error("Public web grounding returned no verifiable URL citations");
  }
  return { status: "used", citations };
}
