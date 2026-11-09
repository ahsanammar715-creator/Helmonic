import assert from "node:assert/strict";
import test from "node:test";

import {
  AzureRequestError,
  azureRequestError,
  safeAzureRequestDiagnostic,
} from "../../src/lib/server/azure-request-error.ts";

test("captures safe Azure failure metadata without retaining the response body", async () => {
  const error = await azureRequestError(
    new Response(
      JSON.stringify({
        error: {
          code: "InvalidRequestParameter",
          message: "Unknown field 'content_vector'.",
        },
      }),
      {
        status: 400,
        headers: { "x-ms-request-id": "azure-request-123" },
      },
    ),
    { service: "Azure AI Search", stage: "search" },
  );

  assert.ok(error instanceof AzureRequestError);
  assert.deepEqual(safeAzureRequestDiagnostic(error), {
    service: "Azure AI Search",
    stage: "search",
    status: 400,
    code: "InvalidRequestParameter",
    azureRequestId: "azure-request-123",
  });
  assert.match(error.message, /Unknown field 'content_vector'/);
  assert.equal("responseBody" in error, false);
});

test("handles non-JSON Azure failures", async () => {
  const error = await azureRequestError(
    new Response("Gateway timeout", { status: 504 }),
    { service: "Azure OpenAI", stage: "embedding" },
  );

  assert.deepEqual(safeAzureRequestDiagnostic(error), {
    service: "Azure OpenAI",
    stage: "embedding",
    status: 504,
    code: undefined,
    azureRequestId: undefined,
  });
});
