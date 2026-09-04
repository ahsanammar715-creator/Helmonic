import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";
import {
  assertCandidateTarget,
  assertOriginalHash,
  buildCandidateIndexProbe,
  EXPECTED_BATCH_ID,
  EXPECTED_DOCUMENT_COUNT,
  EXPECTED_PERMISSION_SCOPE,
  validateCorpusPilotPayload,
} from "./corpus-pilot-contract.mjs";
import { waitForManifestParity } from "./index-parity.mjs";

const searchApiVersion = process.env.AZURE_SEARCH_API_VERSION || "2025-09-01";
const storageApiVersion = "2023-11-03";
const searchEndpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/+$/, "");
const searchIndex = required("AZURE_SEARCH_INDEX");
const liveIndex = required("HELMONIC_LIVE_SEARCH_INDEX");
const storageAccount = required("AZURE_STORAGE_ACCOUNT");
const blobContainer = process.env.AZURE_STORAGE_CONTAINER || "consult-sources";
const payloadRoot = process.env.HELMONIC_INGESTION_PAYLOAD || "/payload";
const embeddingEndpoint = required("AZURE_OPENAI_EMBEDDING_ENDPOINT").replace(/\/+$/, "");
const embeddingDeployment = required("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
const embeddingApiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || "2024-10-21";
const embeddingDimensions = positiveInteger("AZURE_OPENAI_EMBEDDING_DIMENSIONS", 1536);
const embeddingBatchSize = positiveInteger("HELMONIC_EMBEDDING_BATCH_SIZE", 16);
const semanticConfiguration = process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION || "consult-semantic-v2";
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
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
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
    signal: AbortSignal.timeout(60_000),
  });
}

function blobUrl(blobName) {
  const encoded = blobName.split("/").map(encodeURIComponent).join("/");
  return `https://${storageAccount}.blob.core.windows.net/${encodeURIComponent(blobContainer)}/${encoded}`;
}

async function uploadOriginal(accessToken, document) {
  const bytes = await assertOriginalHash(payloadRoot, document);
  const blobName = `controlled-corpus/${EXPECTED_BATCH_ID}/${document.sourceId}.pdf`;
  const url = blobUrl(blobName);
  const response = await storageRequest(url, accessToken, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "application/pdf",
      "x-ms-meta-source-id": document.sourceId,
      "x-ms-meta-source-sha256": document.sourceHash,
      "x-ms-meta-permission-scope": document.permissionScope,
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Blob upload failed for ${document.sourceId}: ${response.status}`);
  return url;
}

async function searchRequest(accessToken, path, init = {}) {
  return fetch(`${searchEndpoint}${path}${path.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(searchApiVersion)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-ms-client-request-id": crypto.randomUUID(),
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

async function validateCandidateIndex(accessToken) {
  const response = await searchRequest(
    accessToken,
    `/indexes/${encodeURIComponent(searchIndex)}/docs/search`,
    {
      method: "POST",
      body: JSON.stringify(buildCandidateIndexProbe(embeddingDimensions)),
    },
  );
  if (response.status === 404) {
    throw new Error("Candidate index is missing; schema creation must use the separate deployment identity");
  }
  if (!response.ok) {
    throw new Error(
      `Candidate index data-plane probe failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
    );
  }
}

async function createEmbeddings(accessToken, inputs) {
  let response;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetch(
      `${embeddingEndpoint}/openai/deployments/${encodeURIComponent(embeddingDeployment)}/embeddings?api-version=${encodeURIComponent(embeddingApiVersion)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-ms-client-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ input: inputs, dimensions: embeddingDimensions }),
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (response.ok) break;
    if (response.status !== 429 || attempt === 7) {
      throw new Error(`Embedding request failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
    }
    const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 60_000) : Math.min(2 ** attempt * 1000, 60_000)));
  }
  const result = await response.json();
  const ordered = [...(result.data || [])].sort((left, right) => left.index - right.index);
  if (ordered.length !== inputs.length || ordered.some((item) => item.embedding?.length !== embeddingDimensions)) {
    throw new Error("Embedding response failed vector-count/dimension parity");
  }
  return ordered.map((item) => item.embedding);
}

async function embedChunks(accessToken, chunks) {
  const vectors = new Map();
  for (let offset = 0; offset < chunks.length; offset += embeddingBatchSize) {
    const batch = chunks.slice(offset, offset + embeddingBatchSize);
    const embeddings = await createEmbeddings(accessToken, batch.map((chunk) => chunk.content));
    batch.forEach((chunk, index) => vectors.set(chunk.chunkId, embeddings[index]));
  }
  if (vectors.size !== chunks.length) throw new Error("At least one corpus chunk has no vector");
  return vectors;
}

async function uploadSearchDocuments(accessToken, documents) {
  for (let offset = 0; offset < documents.length; offset += 500) {
    const response = await searchRequest(
      accessToken,
      `/indexes/${encodeURIComponent(searchIndex)}/docs/index`,
      {
        method: "POST",
        body: JSON.stringify({ value: documents.slice(offset, offset + 500).map((item) => ({ "@search.action": "upload", ...item })) }),
      },
    );
    if (!response.ok) throw new Error(`Search upload failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
    const result = await response.json();
    const failures = (result.value || []).filter((item) => item.status !== true);
    if (failures.length) throw new Error(`${failures.length} Search writes failed`);
  }
}

async function loadManifest(accessToken) {
  const values = [];
  for (let skip = 0; ; skip += 1000) {
    const response = await searchRequest(accessToken, `/indexes/${encodeURIComponent(searchIndex)}/docs/search`, {
      method: "POST",
      body: JSON.stringify({ search: "*", top: 1000, skip, select: "chunk_id,source_id,title,page_number" }),
    });
    if (!response.ok) throw new Error(`Candidate parity read failed: ${response.status}`);
    const page = (await response.json()).value || [];
    values.push(...page);
    if (page.length < 1000) break;
  }
  return values;
}

function distinctiveQuestion(document) {
  const words = document.chunks
    .slice(0, 4)
    .flatMap((chunk) => chunk.content.match(/[A-Za-z][A-Za-z'-]{5,}/g) || [])
    .map((word) => word.toLowerCase())
    .filter((word) => !["acoustic", "report", "project", "document", "assessment", "consultant"].includes(word));
  return [...new Set(words)].slice(0, 6).join(" ");
}

async function hybridQuery(searchToken, embeddingToken, question, permissionScope) {
  const [vector] = await createEmbeddings(embeddingToken, [question]);
  const response = await searchRequest(searchToken, `/indexes/${encodeURIComponent(searchIndex)}/docs/search`, {
    method: "POST",
    body: JSON.stringify({
      search: question,
      queryType: "semantic",
      semanticConfiguration,
      searchMode: "all",
      searchFields: "title,section,content",
      filter: `permission_scope eq '${permissionScope.replace(/'/g, "''")}'`,
      top: 5,
      select: "chunk_id,source_id,title,page_number,content",
      vectorFilterMode: "preFilter",
      vectorQueries: [{ kind: "vector", vector, fields: "content_vector", k: 50 }],
    }),
  });
  if (!response.ok) throw new Error(`Hybrid validation query failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  const value = (await response.json()).value || [];
  return value.filter((item) => typeof item["@search.rerankerScore"] === "number" && item["@search.rerankerScore"] >= 2);
}

async function validateQueries(searchToken, embeddingToken, documents) {
  const distributed = [0, 16, 33, 50, 67, 84];
  const cases = [];
  for (const index of distributed) {
    const document = documents[index];
    const question = distinctiveQuestion(document);
    if (!question) throw new Error(`Could not derive a retrieval probe for ${document.sourceId}`);
    const retained = await hybridQuery(searchToken, embeddingToken, question, EXPECTED_PERMISSION_SCOPE);
    cases.push({ id: `source-probe-${index + 1}`, passed: retained.some((item) => item.source_id === document.sourceId), retained: retained.length });
  }
  const allowed = await searchRequest(searchToken, `/indexes/${encodeURIComponent(searchIndex)}/docs/search`, {
    method: "POST",
    body: JSON.stringify({ search: "*", filter: `permission_scope eq '${EXPECTED_PERMISSION_SCOPE}'`, top: 1, select: "source_id" }),
  }).then((response) => response.json());
  cases.push({ id: "internal-scope-visible", passed: (allowed.value || []).length === 1, retained: (allowed.value || []).length });
  const denied = await searchRequest(searchToken, `/indexes/${encodeURIComponent(searchIndex)}/docs/search`, {
    method: "POST",
    body: JSON.stringify({ search: "*", filter: "permission_scope eq 'unauthorized-evaluation-scope'", top: 1, select: "source_id" }),
  }).then((response) => response.json());
  cases.push({ id: "unauthorized-scope-hidden", passed: (denied.value || []).length === 0, retained: (denied.value || []).length });
  if (cases.some((item) => !item.passed)) throw new Error(`Corpus pilot query validation failed: ${JSON.stringify(cases)}`);
  return cases;
}

async function main() {
  assertCandidateTarget(searchIndex, liveIndex);
  const payload = JSON.parse(await readFile(join(payloadRoot, "payload.json"), "utf8"));
  validateCorpusPilotPayload(payload);
  const [storageToken, searchToken, embeddingToken] = await Promise.all([
    token("https://storage.azure.com/.default"),
    token("https://search.azure.com/.default"),
    token("https://cognitiveservices.azure.com/.default"),
  ]);
  await validateCandidateIndex(searchToken);

  const chunks = payload.documents.flatMap((document) => document.chunks);
  const vectors = await embedChunks(embeddingToken, chunks);
  const sourceUris = new Map();
  for (const document of payload.documents) {
    sourceUris.set(document.sourceId, await uploadOriginal(storageToken, document));
  }
  const ingestedAt = new Date().toISOString();
  const searchDocuments = payload.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      chunk_id: chunk.chunkId,
      source_id: document.sourceId,
      source_uri: sourceUris.get(document.sourceId),
      title: document.title,
      section: chunk.section,
      page_number: chunk.pageNumber,
      content: chunk.content,
      chunk_kind: chunk.kind,
      content_format: chunk.contentFormat,
      content_vector: vectors.get(chunk.chunkId),
      permission_scope: document.permissionScope,
      content_hash: chunk.contentHash,
      ingested_at: ingestedAt,
    })),
  );
  await uploadSearchDocuments(searchToken, searchDocuments);
  const expectedManifest = searchDocuments.map((item) => ({
    chunk_id: item.chunk_id,
    source_id: item.source_id,
    title: item.title,
    page_number: item.page_number,
  }));
  await waitForManifestParity({ expected: expectedManifest, label: `${searchIndex} corpus pilot`, load: () => loadManifest(searchToken), attempts: 12 });
  const cases = await validateQueries(searchToken, embeddingToken, payload.documents);
  process.stdout.write(JSON.stringify({
    status: "complete",
    batchId: EXPECTED_BATCH_ID,
    index: searchIndex,
    documentCount: EXPECTED_DOCUMENT_COUNT,
    chunkCount: searchDocuments.length,
    embeddingCount: vectors.size,
    embeddingDimensions,
    permissionScope: EXPECTED_PERMISSION_SCOPE,
    queryCases: cases,
    promotionReady: false,
  }));
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown corpus pilot failure" }));
  process.exitCode = 1;
});
