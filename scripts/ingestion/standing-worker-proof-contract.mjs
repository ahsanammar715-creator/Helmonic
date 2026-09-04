const proofIdPattern = /^standing-worker-[a-z0-9]{8,32}$/;

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpsEndpoint(environment, name) {
  const value = required(environment, name).replace(/\/$/, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return value;
}

export function loadStandingWorkerProofConfig(environment = process.env) {
  const clientId = required(environment, "AZURE_CLIENT_ID");
  const proofId = required(environment, "HELMONIC_STANDING_WORKER_PROOF_ID");
  if (!proofIdPattern.test(proofId)) {
    throw new Error(
      "HELMONIC_STANDING_WORKER_PROOF_ID must match standing-worker-[a-z0-9]{8,32}",
    );
  }

  const storageContainer = required(environment, "AZURE_STORAGE_SESSION_CONTAINER");
  if (storageContainer !== "consult-session-uploads") {
    throw new Error("Standing-worker proof is restricted to consult-session-uploads");
  }

  const searchIndex = required(environment, "AZURE_SEARCH_SESSION_INDEX");
  if (searchIndex !== "consult-session-v1") {
    throw new Error("Standing-worker proof is restricted to consult-session-v1");
  }

  const embeddingDimensions = Number.parseInt(
    required(environment, "AZURE_OPENAI_EMBEDDING_DIMENSIONS"),
    10,
  );
  if (embeddingDimensions !== 1536) {
    throw new Error("Standing-worker proof requires the approved 1,536 dimensions");
  }

  const token = proofId.slice("standing-worker-".length);
  return Object.freeze({
    clientId,
    proofId,
    storageAccount: required(environment, "AZURE_STORAGE_ACCOUNT"),
    storageContainer,
    blobName: `validation/standing-worker/${proofId}.json`,
    searchEndpoint: httpsEndpoint(environment, "AZURE_SEARCH_ENDPOINT"),
    searchIndex,
    searchApiVersion: required(environment, "AZURE_SEARCH_API_VERSION"),
    embeddingEndpoint: httpsEndpoint(environment, "AZURE_OPENAI_EMBEDDING_ENDPOINT"),
    embeddingDeployment: required(environment, "AZURE_OPENAI_EMBEDDING_DEPLOYMENT"),
    embeddingApiVersion: required(environment, "AZURE_OPENAI_EMBEDDING_API_VERSION"),
    embeddingDimensions,
    documentId: `standing-worker-${token}`,
    ownerObjectId: `validation-owner-${token}`,
    conversationId: `validation-conversation-${token}`,
    permissionScope: `validation:standing-worker:${token}`,
    content: `helmonic standing worker isolated proof ${token}`,
  });
}

export function encodedBlobPath(blobName) {
  return blobName.split("/").map(encodeURIComponent).join("/");
}

export function assertSearchIndexingSucceeded(payload, action) {
  const result = payload?.value?.[0];
  if (result?.status !== true) {
    throw new Error(
      `Azure AI Search ${action} failed: ${result?.errorMessage || "missing success result"}`,
    );
  }
}
