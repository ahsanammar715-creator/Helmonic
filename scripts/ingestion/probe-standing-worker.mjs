import { createHash, randomUUID } from "node:crypto";

import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";
import {
  assertSearchIndexingSucceeded,
  encodedBlobPath,
  loadStandingWorkerProofConfig,
} from "./standing-worker-proof-contract.mjs";

const config = loadStandingWorkerProofConfig();
const credential = createUserAssignedManagedIdentityCredential();
const storageApiVersion = "2023-11-03";

async function accessToken(scope) {
  const result = await credential.getToken(scope);
  if (!result?.token) throw new Error(`No managed-identity token for ${scope}`);
  return result.token;
}

async function checkedFetch(label, url, init, expectedStatuses) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(60_000),
  });
  if (!expectedStatuses.includes(response.status)) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`${label} failed with status ${response.status}: ${detail}`);
  }
  return response;
}

function blobUrl() {
  return `https://${config.storageAccount}.blob.core.windows.net/${encodeURIComponent(
    config.storageContainer,
  )}/${encodedBlobPath(config.blobName)}`;
}

function storageHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "x-ms-version": storageApiVersion,
    "x-ms-date": new Date().toUTCString(),
    "x-ms-client-request-id": randomUUID(),
    ...extra,
  };
}

function searchUrl(path) {
  return `${config.searchEndpoint}/indexes/${encodeURIComponent(config.searchIndex)}/${path}?api-version=${encodeURIComponent(config.searchApiVersion)}`;
}

async function searchIndexAction(token, action, document) {
  const response = await checkedFetch(
    `Search ${action}`,
    searchUrl("docs/index"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": randomUUID(),
      },
      body: JSON.stringify({
        value: [{ "@search.action": action, ...document }],
      }),
    },
    [200],
  );
  assertSearchIndexingSucceeded(await response.json(), action);
}

async function searchForProof(token) {
  const response = await checkedFetch(
    "Search query",
    searchUrl("docs/search"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": randomUUID(),
      },
      body: JSON.stringify({
        search: config.content,
        searchMode: "all",
        filter: `chunk_id eq '${config.documentId}'`,
        select: "chunk_id,document_id,title,content",
        top: 1,
      }),
    },
    [200],
  );
  return (await response.json()).value ?? [];
}

async function waitForSearchState(token, shouldExist) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const results = await searchForProof(token);
    if ((results.length === 1) === shouldExist) return results;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Synthetic Search document did not become ${shouldExist ? "visible" : "absent"}`);
}

async function createEmbedding(token) {
  const response = await checkedFetch(
    "Embedding request",
    `${config.embeddingEndpoint}/openai/deployments/${encodeURIComponent(
      config.embeddingDeployment,
    )}/embeddings?api-version=${encodeURIComponent(config.embeddingApiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": randomUUID(),
      },
      body: JSON.stringify({
        input: config.content,
        dimensions: config.embeddingDimensions,
      }),
    },
    [200],
  );
  const vector = (await response.json()).data?.[0]?.embedding;
  if (
    !Array.isArray(vector) ||
    vector.length !== config.embeddingDimensions ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Embedding proof returned an invalid vector");
  }
  return vector.length;
}

async function main() {
  const [storageToken, searchToken, embeddingToken] = await Promise.all([
    accessToken("https://storage.azure.com/.default"),
    accessToken("https://search.azure.com/.default"),
    accessToken("https://cognitiveservices.azure.com/.default"),
  ]);

  const body = Buffer.from(
    JSON.stringify({
      proof_id: config.proofId,
      synthetic: true,
      content: config.content,
    }),
  );
  const digest = createHash("sha256").update(body).digest("hex");
  const blob = blobUrl();
  let blobCreated = false;
  let searchDocumentCreated = false;
  let primaryError;

  const searchDocument = {
    chunk_id: config.documentId,
    document_id: config.documentId,
    document_version_id: `${config.documentId}-v1`,
    owner_object_id: config.ownerObjectId,
    conversation_id: config.conversationId,
    source_type: "standing_identity_proof",
    source_uri: `blob://${config.storageContainer}/${config.blobName}`,
    title: "Synthetic standing-worker identity proof",
    section: "isolated validation",
    page_number: 1,
    content: config.content,
    content_hash: digest,
    is_active: true,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  try {
    await checkedFetch(
      "Synthetic Blob upload",
      blob,
      {
        method: "PUT",
        headers: storageHeaders(storageToken, {
          "x-ms-blob-type": "BlockBlob",
          "x-ms-meta-proof": "standing-worker",
          "x-ms-meta-sha256": digest,
          "Content-Type": "application/json",
          "If-None-Match": "*",
        }),
        body,
      },
      [201],
    );
    blobCreated = true;

    const head = await checkedFetch(
      "Synthetic Blob metadata read",
      blob,
      { headers: storageHeaders(storageToken) },
      [200],
    );
    if (
      Number(head.headers.get("content-length")) !== body.length ||
      head.headers.get("x-ms-meta-sha256") !== digest
    ) {
      throw new Error("Synthetic Blob metadata did not match the uploaded proof");
    }

    const read = await checkedFetch(
      "Synthetic Blob range read",
      blob,
      { headers: storageHeaders(storageToken, { Range: `bytes=0-${body.length - 1}` }) },
      [206],
    );
    if (!Buffer.from(await read.arrayBuffer()).equals(body)) {
      throw new Error("Synthetic Blob read-back did not match the uploaded proof");
    }

    const embeddingDimensions = await createEmbedding(embeddingToken);

    await searchIndexAction(searchToken, "upload", searchDocument);
    searchDocumentCreated = true;
    const results = await waitForSearchState(searchToken, true);
    if (results[0]?.chunk_id !== config.documentId || results[0]?.content !== config.content) {
      throw new Error("Synthetic Search query returned unexpected content");
    }

    console.log(
      JSON.stringify({
        proofId: config.proofId,
        identityClientId: config.clientId,
        blobUploadReadBack: "passed",
        embeddingDimensions,
        searchWriteQuery: "passed",
        realContentUsed: false,
      }),
    );
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    if (searchDocumentCreated) {
      try {
        await searchIndexAction(searchToken, "delete", { chunk_id: config.documentId });
        await waitForSearchState(searchToken, false);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (blobCreated) {
      try {
        await checkedFetch(
          "Synthetic Blob delete",
          blob,
          { method: "DELETE", headers: storageHeaders(storageToken) },
          [202],
        );
        await checkedFetch(
          "Synthetic Blob deletion check",
          blob,
          { method: "HEAD", headers: storageHeaders(storageToken) },
          [404],
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (primaryError || cleanupErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors].filter(Boolean),
        "Standing-worker identity proof or cleanup failed",
      );
    }
  }
}

await main();
