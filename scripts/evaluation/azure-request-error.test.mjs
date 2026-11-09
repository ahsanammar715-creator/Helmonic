import assert from "node:assert/strict";
import test from "node:test";

import {
  AzureRequestError,
  azureRequestError,
  isSemanticSearchQuotaError,
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

test("recognizes only the semantic Search quota exhaustion eligible for fallback", async () => {
  const semanticQuotaError = await azureRequestError(
    new Response(
      JSON.stringify({
        error: {
          code: "InvalidRequestParameter",
          message:
            "Free Query Semantic Usage exceeded for the month. Please enable semantic billing to continue using semantic search.",
        },
      }),
      { status: 402 },
    ),
    { service: "Azure AI Search", stage: "search" },
  );
  const unrelatedPaymentError = await azureRequestError(
    new Response("Payment required", { status: 402 }),
    { service: "Azure AI Search", stage: "search" },
  );
  const authorizationError = await azureRequestError(
    new Response("Forbidden", { status: 403 }),
    { service: "Azure AI Search", stage: "search" },
  );

  assert.equal(isSemanticSearchQuotaError(semanticQuotaError), true);
  assert.equal(isSemanticSearchQuotaError(unrelatedPaymentError), false);
  assert.equal(isSemanticSearchQuotaError(authorizationError), false);
});
