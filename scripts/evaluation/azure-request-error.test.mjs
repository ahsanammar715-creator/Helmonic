import assert from "node:assert/strict";
import test from "node:test";

import {
  azureRetryDelayMilliseconds,
  AzureRequestError,
  azureRequestError,
  isSemanticSearchQuotaError,
  isTransientAzureRequestFailure,
  retryTransientAzureOperation,
  safeAzureRequestDiagnostic,
} from "../../src/lib/server/azure-request-error.ts";

test("uses Azure retry headers and bounds claim-audit backoff", () => {
  assert.equal(
    azureRetryDelayMilliseconds(
      { headers: new Headers({ "x-ms-retry-after-ms": "2500" }) },
      0,
    ),
    2500,
  );
  assert.equal(
    azureRetryDelayMilliseconds(
      { headers: new Headers({ "retry-after": "90" }) },
      0,
    ),
    60_000,
  );
  assert.equal(azureRetryDelayMilliseconds({ headers: new Headers() }, 0), 20_000);
  assert.equal(azureRetryDelayMilliseconds({ headers: new Headers() }, 1), 40_000);
});

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

test("retries transient dependency failures once without retrying permanent failures", async () => {
  const transientError = await azureRequestError(
    new Response("Temporary upstream failure", { status: 503 }),
    { service: "Azure OpenAI", stage: "model" },
  );
  const permanentError = await azureRequestError(
    new Response("Bad request", { status: 400 }),
    { service: "Azure AI Search", stage: "search" },
  );

  assert.equal(isTransientAzureRequestFailure(transientError), true);
  assert.equal(isTransientAzureRequestFailure(permanentError), false);
  assert.equal(isTransientAzureRequestFailure(new DOMException("Timed out", "TimeoutError")), true);

  let transientAttempts = 0;
  const recovered = await retryTransientAzureOperation(
    async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) throw transientError;
      return "recovered";
    },
    {
      requestId: "request-transient-retry",
      operation: "test-operation",
      delayMilliseconds: 1,
    },
  );
  assert.equal(recovered, "recovered");
  assert.equal(transientAttempts, 2);

  let permanentAttempts = 0;
  await assert.rejects(
    () =>
      retryTransientAzureOperation(
        async () => {
          permanentAttempts += 1;
          throw permanentError;
        },
        {
          requestId: "request-permanent-failure",
          operation: "test-operation",
          delayMilliseconds: 1,
        },
      ),
    permanentError,
  );
  assert.equal(permanentAttempts, 1);
});
