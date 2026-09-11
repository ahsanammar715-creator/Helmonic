import "server-only";

import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
};

export async function createQueryEmbedding(
  input: string,
  requestId: string,
  config: RuntimeConfig,
) {
  if (!config.embedding.endpoint || !config.embedding.deployment) {
    throw new Error("Azure embedding model is not configured");
  }

  const token = await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
  const response = await fetch(
    `${config.embedding.endpoint}/openai/deployments/${encodeURIComponent(
      config.embedding.deployment,
    )}/embeddings?api-version=${encodeURIComponent(config.embedding.apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": requestId,
      },
      body: JSON.stringify({
        input,
        dimensions: config.embedding.dimensions,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(config.embedding.timeoutMilliseconds),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure embedding request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (
    !Array.isArray(embedding) ||
    embedding.length !== config.embedding.dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Azure embedding response has an invalid vector");
  }

  return embedding;
}
