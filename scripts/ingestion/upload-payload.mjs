import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { DefaultAzureCredential } from "@azure/identity";

const searchApiVersion = process.env.AZURE_SEARCH_API_VERSION || "2025-09-01";
const storageApiVersion = "2023-11-03";
const searchEndpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/+$/, "");
const searchIndex = required("AZURE_SEARCH_INDEX");
const storageAccount = required("AZURE_STORAGE_ACCOUNT");
const blobContainer = process.env.AZURE_STORAGE_CONTAINER || "consult-sources";
const payloadRoot = process.env.HELMONIC_INGESTION_PAYLOAD || "/payload";
const payloadPath = join(payloadRoot, "payload.json");
const schemaPath = process.env.HELMONIC_INDEX_SCHEMA || join(
  process.cwd(),
  "scripts",
  "ingestion",
  "index-schema.json",
);

const credential = new DefaultAzureCredential();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
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

  if (existing.ok) return;
  if (existing.status !== 404) {
    throw new Error(`Search index lookup failed with status ${existing.status}`);
  }

  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  schema.name = searchIndex;
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
  if (!Array.isArray(payload.documents) || payload.documents.length !== 5) {
    throw new Error("Phase 1A ingestion requires exactly five approved source documents");
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

  const [storageToken, searchToken] = await Promise.all([
    token("https://storage.azure.com/.default"),
    token("https://search.azure.com/.default"),
  ]);
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
      chunkCount: searchDocuments.length,
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
