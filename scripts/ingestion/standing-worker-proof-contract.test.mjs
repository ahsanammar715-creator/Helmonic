import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSearchIndexingSucceeded,
  encodedBlobPath,
  loadStandingWorkerProofConfig,
} from "./standing-worker-proof-contract.mjs";

const valid = {
  AZURE_CLIENT_ID: "standing-client-id",
  HELMONIC_STANDING_WORKER_PROOF_ID: "standing-worker-a1b2c3d4",
  AZURE_STORAGE_ACCOUNT: "sthelmonicdev001",
  AZURE_STORAGE_SESSION_CONTAINER: "consult-session-uploads",
  AZURE_SEARCH_ENDPOINT: "https://srch-helmonic-dev-001.search.windows.net/",
  AZURE_SEARCH_SESSION_INDEX: "consult-session-v1",
  AZURE_SEARCH_API_VERSION: "2024-07-01",
  AZURE_OPENAI_EMBEDDING_ENDPOINT: "https://aif-helmonic-embed-dev-001.openai.azure.com/",
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: "text-embedding-3-small-helmonic-dev",
  AZURE_OPENAI_EMBEDDING_API_VERSION: "2024-10-21",
  AZURE_OPENAI_EMBEDDING_DIMENSIONS: "1536",
};

test("builds synthetic targets only in the isolated container and index", () => {
  const config = loadStandingWorkerProofConfig(valid);
  assert.equal(config.storageContainer, "consult-session-uploads");
  assert.equal(config.searchIndex, "consult-session-v1");
  assert.match(config.blobName, /^validation\/standing-worker\//);
  assert.match(config.permissionScope, /^validation:standing-worker:/);
  assert.doesNotMatch(config.content, /iAcoustics|Wetherspoon|Premier Inn/i);
});

test("requires an explicit standing UAMI client ID", () => {
  assert.throws(
    () => loadStandingWorkerProofConfig({ ...valid, AZURE_CLIENT_ID: " " }),
    /AZURE_CLIENT_ID is required/,
  );
});

test("refuses the live controlled index", () => {
  assert.throws(
    () =>
      loadStandingWorkerProofConfig({
        ...valid,
        AZURE_SEARCH_SESSION_INDEX: "consult-demo-v2",
      }),
    /restricted to consult-session-v1/,
  );
});

test("refuses a non-session Blob container", () => {
  assert.throws(
    () =>
      loadStandingWorkerProofConfig({
        ...valid,
        AZURE_STORAGE_SESSION_CONTAINER: "consult-controlled-audio",
      }),
    /restricted to consult-session-uploads/,
  );
});

test("refuses malformed proof IDs and embedding dimensions", () => {
  assert.throws(
    () =>
      loadStandingWorkerProofConfig({
        ...valid,
        HELMONIC_STANDING_WORKER_PROOF_ID: "production",
      }),
    /must match/,
  );
  assert.throws(
    () =>
      loadStandingWorkerProofConfig({
        ...valid,
        AZURE_OPENAI_EMBEDDING_DIMENSIONS: "3072",
      }),
    /1,536 dimensions/,
  );
});

test("encodes each Blob path segment without losing separators", () => {
  assert.equal(encodedBlobPath("validation/a b.json"), "validation/a%20b.json");
});

test("accepts only an explicit successful Search indexing result", () => {
  assert.doesNotThrow(() =>
    assertSearchIndexingSucceeded({ value: [{ status: true }] }, "upload"),
  );
  assert.throws(
    () => assertSearchIndexingSucceeded({ value: [{ status: false }] }, "delete"),
    /Search delete failed/,
  );
});
