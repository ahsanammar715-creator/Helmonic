import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";
import {
  assertManifestParity,
  waitForManifestParity,
} from "./index-parity.mjs";

const searchApiVersion = process.env.AZURE_SEARCH_API_VERSION || "2025-09-01";
const storageApiVersion = "2023-11-03";
const searchEndpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/+$/, "");
const searchIndex = required("AZURE_SEARCH_INDEX");
const storageAccount = required("AZURE_STORAGE_ACCOUNT");
const blobContainer = process.env.AZURE_STORAGE_CONTAINER || "consult-sources";
const payloadRoot = process.env.HELMONIC_INGESTION_PAYLOAD || "/payload";
const payloadPath = join(payloadRoot, "payload.json");
const expectedDocumentCount = positiveInteger(
  "HELMONIC_INGESTION_EXPECTED_DOCUMENT_COUNT",
  16,
);
const schemaPath = process.env.HELMONIC_INDEX_SCHEMA || join(
  process.cwd(),
  "scripts",
  "ingestion",
  "index-schema.json",
);
const hybridIngestionEnabled = process.env.HELMONIC_HYBRID_INGESTION_ENABLED === "true";
const rollbackIndex = process.env.AZURE_SEARCH_ROLLBACK_INDEX || "consult-demo-v1";
const embeddingEndpoint = (
  process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT ||
  process.env.AZURE_OPENAI_ENDPOINT ||
  ""
).replace(/\/+$/, "");
const embeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || "";
const embeddingApiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || "2024-10-21";
const embeddingDimensions = positiveInteger("AZURE_OPENAI_EMBEDDING_DIMENSIONS", 1536);
const embeddingBatchSize = positiveInteger("HELMONIC_EMBEDDING_BATCH_SIZE", 16);

const credential = createUserAssignedManagedIdentityCredential();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || String(value) !== raw) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function token(scope) {
  const accessToken = await credential.getToken(scope);
  if (!accessToken?.token) throw new Error(`No managed-identity token for ${scope}`);
  return accessToken.token;
}

async function storageRequest(url, accessToken, init = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-ms-version": storageApiVersion,
      "x-ms-date": new Date().toUTCString(),
      "x-ms-client-request-id": crypto.randomUUID(),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function ensureBlobContainer(accessToken) {
  const url = `https://${storageAccount}.blob.core.windows.net/${encodeURIComponent(
    blobContainer,
  )}?restype=container`;
  const response = await storageRequest(url, accessToken, { method: "PUT" });
  if (!response.ok && response.status !== 409) {
    throw new Error(`Blob container creation failed with status ${response.status}`);
  }
}

async function uploadOriginal(accessToken, fileName) {
  const safeName = basename(fileName);
  const bytes = await readFile(join(payloadRoot, "originals", safeName));
  const response = await storageRequest(
    `https://${storageAccount}.blob.core.windows.net/${encodeURIComponent(
      blobContainer,
    )}/${encodeURIComponent(safeName)}`,
    accessToken,
    {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "application/octet-stream",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    throw new Error(`Blob upload for ${safeName} failed with status ${response.status}`);
  }

  return `https://${storageAccount}.blob.core.windows.net/${blobContainer}/${encodeURIComponent(
    safeName,
  )}`;
}

async function ensureSearchIndex(accessToken) {
  const existing = await fetch(
    `${searchEndpoint}/indexes/${encodeURIComponent(searchIndex)}?api-version=${searchApiVersion}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (existing.ok) {
    if (hybridIngestionEnabled) {
      validateHybridIndexSchema(await existing.json());
    }
    return;
  }
  if (existing.status !== 404) {
    throw new Error(`Search index lookup failed with status ${existing.status}`);
  }

  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  schema.name = searchIndex;
  if (hybridIngestionEnabled) validateHybridIndexSchema(schema);
  const created = await fetch(`${searchEndpoint}/indexes?api-version=${searchApiVersion}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-ms-client-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(schema),
    signal: AbortSignal.timeout(30_000),
  });

  if (!created.ok) {
    throw new Error(`Search index creation failed with status ${created.status}`);
  }
}

function validateHybridIndexSchema(schema) {
  const vectorField = schema.fields?.find((field) => field.name === "content_vector");
  if (
    !vectorField ||
    vectorField.type !== "Collection(Edm.Single)" ||
    vectorField.dimensions !== embeddingDimensions ||
    !vectorField.vectorSearchProfile
  ) {
    throw new Error(
      `Hybrid index must define a ${embeddingDimensions}-dimension content_vector field`,
    );
  }
  const algorithms = schema.vectorSearch?.algorithms || [];
  if (!algorithms.some((algorithm) => algorithm.kind === "hnsw")) {
    throw new Error("Hybrid index must define an HNSW vector algorithm");
  }
}

async function createEmbeddings(accessToken, inputs) {
  let response;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetch(
      `${embeddingEndpoint}/openai/deployments/${encodeURIComponent(
        embeddingDeployment,
      )}/embeddings?api-version=${encodeURIComponent(embeddingApiVersion)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-ms-client-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ input: inputs, dimensions: embeddingDimensions }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.ok) break;
    if (response.status !== 429 || attempt === 7) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Embedding batch failed with status ${response.status}: ${details}`);
    }

    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") || "", 10);
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds, 1) * 1000, 60_000)
      : Math.min(2 ** attempt * 1000, 60_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (!response?.ok) throw new Error("Embedding batch retry policy exhausted");

  const payload = await response.json();
  const ordered = [...(payload.data || [])].sort((left, right) => left.index - right.index);
  if (
    ordered.length !== inputs.length ||
    ordered.some(
      (item) =>
        !Array.isArray(item.embedding) ||
        item.embedding.length !== embeddingDimensions ||
        item.embedding.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new Error("Embedding response did not contain one valid vector per chunk");
  }
  return ordered.map((item) => item.embedding);
}

async function embedEveryChunk(accessToken, chunks) {
  const vectors = new Map();
  for (let offset = 0; offset < chunks.length; offset += embeddingBatchSize) {
    const batch = chunks.slice(offset, offset + embeddingBatchSize);
    const embeddings = await createEmbeddings(
      accessToken,
      batch.map((chunk) => chunk.content),
    );
    for (let index = 0; index < batch.length; index += 1) {
      vectors.set(batch[index].chunkId, embeddings[index]);
    }
  }
  if (vectors.size !== chunks.length) {
    throw new Error("Hybrid index is not ready: at least one chunk has no embedding");
  }
  return vectors;
}

async function loadIndexManifest(accessToken, indexName) {
  const documents = [];
  for (let skip = 0; ; skip += 1000) {
    const response = await fetch(
      `${searchEndpoint}/indexes/${encodeURIComponent(
        indexName,
      )}/docs/search?api-version=${searchApiVersion}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-ms-client-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          search: "*",
          top: 1000,
          skip,
          select: "chunk_id,source_id,title,page_number",
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Index parity read for ${indexName} failed with ${response.status}`);
    }
    const page = await response.json();
    const values = Array.isArray(page.value) ? page.value : [];
    documents.push(...values);
    if (values.length < 1000) break;
  }
  return documents;
}

function validateHybridExtraction(payload) {
  if (
    payload.extraction?.version !== 2 ||
    payload.extraction?.tableStrategy !== "atomic-markdown-or-key-value"
  ) {
    throw new Error(
      "Hybrid ingestion requires extraction version 2 with atomic table preservation",
    );
  }
  for (const document of payload.documents) {
    if (!Array.isArray(document.tablePageNumbers)) {
      throw new Error(`Source ${document.sourceId} must declare tablePageNumbers`);
    }
    const declaredTablePages = new Set(document.tablePageNumbers);
    for (const chunk of document.chunks) {
      if (chunk.kind !== "text" && chunk.kind !== "table") {
        throw new Error(`Chunk ${chunk.chunkId} must declare kind text or table`);
      }
      if (chunk.kind === "table") {
        if (
          chunk.atomic !== true ||
          (chunk.contentFormat !== "markdown" && chunk.contentFormat !== "key_value") ||
          !Number.isInteger(chunk.pageNumber)
        ) {
          throw new Error(
            `Table chunk ${chunk.chunkId} must be atomic, page-bound, and structured`,
          );
        }
        const structured =
          chunk.contentFormat === "markdown"
            ? /\|[^\n]+\|/.test(chunk.content) && /\|\s*:?-{3,}/.test(chunk.content)
            : chunk.content
                .split(/\r?\n/)
                .filter((line) => /^[^:\n]+:\s*\S+/.test(line)).length >= 2;
        if (!structured) {
          throw new Error(
            `Table chunk ${chunk.chunkId} is not valid ${chunk.contentFormat} structured content`,
          );
        }
      }
    }
    for (const pageNumber of declaredTablePages) {
      if (
        !document.chunks.some(
          (chunk) => chunk.kind === "table" && chunk.pageNumber === pageNumber,
        )
      ) {
        throw new Error(
          `Source ${document.sourceId} is missing an atomic table chunk for page ${pageNumber}`,
        );
      }
    }
  }
}

async function uploadSearchDocuments(accessToken, documents) {
  const response = await fetch(
    `${searchEndpoint}/indexes/${encodeURIComponent(
      searchIndex,
    )}/docs/index?api-version=${searchApiVersion}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        value: documents.map((document) => ({
          "@search.action": "mergeOrUpload",
          ...document,
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Search document upload failed with status ${response.status}`);
  }

  const result = await response.json();
  const failures = (result.value || []).filter((item) => item.status !== true);
  if (failures.length > 0) {
    throw new Error(`${failures.length} Search document operations failed`);
  }
}

function filterValue(value) {
  return value.replace(/'/g, "''");
}

async function verifySearch(accessToken, permissionScope, question) {
  const response = await fetch(
    `${searchEndpoint}/indexes/${encodeURIComponent(
      searchIndex,
    )}/docs/search?api-version=${searchApiVersion}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        search: question,
        filter: `permission_scope eq '${filterValue(permissionScope)}'`,
        top: 1,
        select: "chunk_id,source_id,title",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Search verification failed with status ${response.status}`);
  }

  const result = await response.json();
  if (!Array.isArray(result.value) || result.value.length === 0) {
    throw new Error("Search verification returned no permitted evidence");
  }

  return result.value[0].source_id;
}

async function main() {
  const payload = JSON.parse(await readFile(payloadPath, "utf8"));
  if (
    !Array.isArray(payload.documents) ||
    payload.documents.length !== expectedDocumentCount
  ) {
    throw new Error(
      `Controlled ingestion requires exactly ${expectedDocumentCount} approved source documents`,
    );
  }

  if (hybridIngestionEnabled) {
    if (!embeddingEndpoint || !embeddingDeployment) {
      throw new Error("Hybrid ingestion requires the managed-identity embedding deployment");
    }
    if (searchIndex === rollbackIndex) {
      throw new Error("Hybrid ingestion must not mutate the consult-demo-v1 rollback index");
    }
    validateHybridExtraction(payload);
  }

  const sourceIds = new Set();
  const chunkIds = new Set();
  for (const document of payload.documents) {
    if (!document.sourceId || sourceIds.has(document.sourceId)) {
      throw new Error("Every sourceId must be present and unique");
    }
    if (!document.title || !document.fileName || !document.permissionScope) {
      throw new Error(`Source ${document.sourceId} is missing required metadata`);
    }
    if (!Array.isArray(document.chunks) || document.chunks.length === 0) {
      throw new Error(`Source ${document.sourceId} must contain at least one source chunk`);
    }
    sourceIds.add(document.sourceId);

    for (const chunk of document.chunks || []) {
      if (!chunk.chunkId || chunkIds.has(chunk.chunkId)) {
        throw new Error("Every chunkId must be present and unique");
      }
      if (!chunk.content?.trim() || !chunk.contentHash) {
        throw new Error(`Chunk ${chunk.chunkId} is missing content or its hash`);
      }
      chunkIds.add(chunk.chunkId);
    }
  }

  const [storageToken, searchToken, embeddingToken] = await Promise.all([
    token("https://storage.azure.com/.default"),
    token("https://search.azure.com/.default"),
    hybridIngestionEnabled
      ? token("https://cognitiveservices.azure.com/.default")
      : Promise.resolve(null),
  ]);

  const payloadChunks = payload.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({ ...chunk, sourceId: document.sourceId })),
  );
  const expectedManifest = payload.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      chunk_id: chunk.chunkId,
      source_id: document.sourceId,
      title: document.title,
      page_number: chunk.pageNumber ?? null,
    })),
  );
  const contentVectors = hybridIngestionEnabled
    ? await embedEveryChunk(embeddingToken, payloadChunks)
    : new Map();

  if (hybridIngestionEnabled) {
    const rollbackManifest = await loadIndexManifest(searchToken, rollbackIndex);
    assertManifestParity(expectedManifest, rollbackManifest, `${rollbackIndex} source`);
  }

  await Promise.all([ensureBlobContainer(storageToken), ensureSearchIndex(searchToken)]);

  const searchDocuments = [];
  for (const document of payload.documents) {
    const sourceUri = await uploadOriginal(storageToken, document.fileName);
    for (const chunk of document.chunks || []) {
      searchDocuments.push({
        chunk_id: chunk.chunkId,
        source_id: document.sourceId,
        source_uri: sourceUri,
        title: document.title,
        section: chunk.section || "",
        page_number: chunk.pageNumber ?? null,
        content: chunk.content,
        ...(hybridIngestionEnabled
          ? {
              chunk_kind: chunk.kind,
              content_format: chunk.contentFormat,
              content_vector: contentVectors.get(chunk.chunkId),
            }
          : {}),
        permission_scope: document.permissionScope,
        content_hash: chunk.contentHash,
        ingested_at: new Date().toISOString(),
      });
    }
  }

  if (searchDocuments.length === 0) {
    throw new Error("No source chunks were supplied");
  }

  for (let offset = 0; offset < searchDocuments.length; offset += 500) {
    await uploadSearchDocuments(searchToken, searchDocuments.slice(offset, offset + 500));
  }

  if (hybridIngestionEnabled) {
    await waitForManifestParity({
      expected: expectedManifest,
      label: `${searchIndex} target`,
      load: () => loadIndexManifest(searchToken, searchIndex),
    });
  }

  const verificationQuestion =
    process.env.HELMONIC_INGESTION_VERIFY_QUERY ||
    searchDocuments[0].content.split(/\s+/).slice(0, 8).join(" ");
  const verifiedSourceId = await verifySearch(
    searchToken,
    payload.documents[0].permissionScope,
    verificationQuestion,
  );

  process.stdout.write(
    JSON.stringify({
      status: "complete",
      documentCount: payload.documents.length,
      expectedDocumentCount,
      chunkCount: searchDocuments.length,
      embeddingCount: contentVectors.size,
      embeddingDimensions: hybridIngestionEnabled ? embeddingDimensions : null,
      rollbackIndex: hybridIngestionEnabled ? rollbackIndex : null,
      index: searchIndex,
      container: blobContainer,
      verifiedSourceId,
    }),
  );
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown ingestion error",
    }),
  );
  process.exitCode = 1;
});
