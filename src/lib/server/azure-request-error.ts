type AzureErrorPayload = {
  code?: unknown;
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

export type AzureRequestStage =
  | "embedding"
  | "search"
  | "search-project-anchor"
  | "search-report-expansion"
  | "search-session"
  | "search-email"
  | "search-count"
  | "model"
  | "claim-evidence-audit";

function boundedString(value: unknown, maximumLength = 600) {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maximumLength
    ? `${compact.slice(0, maximumLength - 1)}…`
    : compact;
}

function responseRequestId(response: Response) {
  return (
    response.headers.get("x-ms-request-id") ??
    response.headers.get("request-id") ??
    response.headers.get("apim-request-id") ??
    undefined
  );
}

export class AzureRequestError extends Error {
  readonly service: string;
  readonly stage: AzureRequestStage;
  readonly status: number;
  readonly azureCode?: string;
  readonly azureRequestId?: string;

  constructor(options: {
    service: string;
    stage: AzureRequestStage;
    status: number;
    azureCode?: string;
    azureMessage?: string;
    azureRequestId?: string;
  }) {
    const detail = options.azureMessage ? `: ${options.azureMessage}` : "";
    super(`${options.service} ${options.stage} request failed with status ${options.status}${detail}`);
    this.name = "AzureRequestError";
    this.service = options.service;
    this.stage = options.stage;
    this.status = options.status;
    this.azureCode = options.azureCode;
    this.azureRequestId = options.azureRequestId;
  }
}

export async function azureRequestError(
  response: Response,
  options: { service: string; stage: AzureRequestStage },
) {
  let payload: AzureErrorPayload | undefined;
  let fallbackMessage: string | undefined;

  try {
    const text = await response.text();
    fallbackMessage = boundedString(text);
    if (text) payload = JSON.parse(text) as AzureErrorPayload;
  } catch {
    // A non-JSON Azure response is still represented by its status and request ID.
  }

  const azureCode = boundedString(payload?.error?.code ?? payload?.code, 160);
  const azureMessage = boundedString(
    payload?.error?.message ?? payload?.message ?? fallbackMessage,
  );

  return new AzureRequestError({
    ...options,
    status: response.status,
    azureCode,
    azureMessage,
    azureRequestId: responseRequestId(response),
  });
}

export function safeAzureRequestDiagnostic(error: unknown) {
  if (!(error instanceof AzureRequestError)) return undefined;
  return {
    service: error.service,
    stage: error.stage,
    status: error.status,
    code: error.azureCode,
    azureRequestId: error.azureRequestId,
  };
}

export function isSemanticSearchQuotaError(error: unknown) {
  if (!(error instanceof AzureRequestError)) return false;
  if (
    error.service !== "Azure AI Search" ||
    error.stage !== "search" ||
    error.status !== 402
  ) {
    return false;
  }

  return (
    /semantic/i.test(error.message) &&
    /(billing|exceed|quota|usage)/i.test(error.message)
  );
}
