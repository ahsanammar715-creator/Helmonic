import "server-only";

import {
  batchClaimEvidenceAudit,
  buildClaimEvidenceAudit,
  validateClaimCitationCoverage,
  validateClaimSupportVerdicts,
  type ClaimSupportVerdict,
} from "@/lib/consult/claim-evidence-policy";
import type { ConsultCitation } from "@/lib/consult/types";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import {
  azureRequestError,
  azureRetryDelayMilliseconds,
} from "@/lib/server/azure-request-error";
import type { RuntimeConfig } from "@/lib/server/config";
import { ModelGatewayValidationError } from "@/lib/server/model-gateway";

type ClaimAuditResponse = {
  verdicts?: ClaimSupportVerdict[];
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function verifyClaimEvidenceSupport(input: {
  requestId: string;
  answer: string;
  citations: ConsultCitation[];
  allowGeneralKnowledge: boolean;
  config: RuntimeConfig;
  unsupportedClaimPolicy?: "reject" | "return";
}) {
  const { endpoint, deployment } = input.config.model;
  if (!endpoint || !deployment) {
    throw new Error("Azure model is not configured for claim-to-evidence validation");
  }
  const coverage = validateClaimCitationCoverage({
    answer: input.answer,
    allowGeneralKnowledge: input.allowGeneralKnowledge,
  });
  if (!coverage.valid) {
    throw new ModelGatewayValidationError(coverage.errors.join(" "));
  }

  const controlledClaims = coverage.claims.filter((claim) => claim.markers.length > 0);
  if (controlledClaims.length === 0) return;

  const token = await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
  const requestUrl = `${endpoint}/openai/deployments/${encodeURIComponent(
    deployment,
  )}/chat/completions?api-version=${encodeURIComponent(input.config.model.apiVersion)}`;
  const batches = batchClaimEvidenceAudit(controlledClaims);
  const verdicts: ClaimSupportVerdict[] = [];

  for (const [batchIndex, batchClaims] of batches.entries()) {
    const audit = buildClaimEvidenceAudit({
      claims: batchClaims,
      citations: input.citations,
    });
    const requestInit: Omit<RequestInit, "signal"> = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": input.requestId,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "You are a strict claim-to-evidence auditor. Assess each claim only against the excerpts attached to that claim. Do not use outside knowledge. A claim is supported only when every project fact, number, metric, material, standard, relationship and recommendation attributed to the cited evidence is directly stated or necessarily entailed by those excerpts. Conservative statements that evidence is absent may be accepted only when the claim is explicitly limited to the supplied excerpts. Return one verdict for every claim id and no others.",
          },
          { role: "user", content: JSON.stringify(audit) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "helmonic_claim_evidence_audit",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                verdicts: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      claimId: { type: "string" },
                      supported: { type: "boolean" },
                      reason: { type: "string" },
                    },
                    required: ["claimId", "supported", "reason"],
                  },
                },
              },
              required: ["verdicts"],
            },
          },
        },
        reasoning_effort: "low",
        verbosity: "low",
        max_completion_tokens: 1_200,
      }),
      cache: "no-store",
    };
    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(requestUrl, {
        ...requestInit,
        signal: AbortSignal.timeout(input.config.model.timeoutMilliseconds),
      });
      if (response.status !== 429 || attempt === 2) break;

      const retryDelayMilliseconds = azureRetryDelayMilliseconds(response, attempt);
      console.warn("Helmonic claim audit throttled; retrying within the bounded gate", {
        requestId: input.requestId,
        batch: batchIndex + 1,
        batchCount: batches.length,
        attempt: attempt + 1,
        retryDelayMilliseconds,
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds));
    }

    if (!response) throw new Error("The claim-evidence audit did not execute.");

    if (!response.ok) {
      throw await azureRequestError(response, {
        service: "Azure OpenAI",
        stage: "claim-evidence-audit",
      });
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ModelGatewayValidationError(
        `The claim-evidence audit was empty for batch ${batchIndex + 1} of ${batches.length}.`,
      );
    }

    let parsed: ClaimAuditResponse;
    try {
      parsed = JSON.parse(content) as ClaimAuditResponse;
    } catch {
      throw new ModelGatewayValidationError(
        `The claim-evidence audit was not valid JSON for batch ${batchIndex + 1} of ${batches.length}.`,
      );
    }

    if (!Array.isArray(parsed.verdicts)) {
      throw new ModelGatewayValidationError(
        `The claim-evidence audit did not return verdicts for batch ${batchIndex + 1} of ${batches.length}.`,
      );
    }
    verdicts.push(...parsed.verdicts);
  }

  const validation = validateClaimSupportVerdicts({
    claims: controlledClaims,
    verdicts,
  });
  const unsupportedClaimIds = new Set(validation.unsupportedClaimIds);
  const structuralErrors = validation.errors.filter(
    (error) =>
      !Array.from(unsupportedClaimIds).some((claimId) =>
        error.startsWith(`${claimId} is not supported by its cited excerpts:`),
      ),
  );
  if (structuralErrors.length > 0) {
    throw new ModelGatewayValidationError(structuralErrors.join(" "));
  }
  if (!validation.valid && input.unsupportedClaimPolicy !== "return") {
    throw new ModelGatewayValidationError(validation.errors.join(" "));
  }

  console.info("Helmonic claim-to-evidence audit", {
    requestId: input.requestId,
    claimCount: controlledClaims.length,
    batchCount: batches.length,
    supported: unsupportedClaimIds.size === 0,
    unsupportedClaimCount: unsupportedClaimIds.size,
  });
  return {
    claimCount: controlledClaims.length,
    batchCount: batches.length,
    unsupportedClaimIds: Array.from(unsupportedClaimIds),
  };
}
