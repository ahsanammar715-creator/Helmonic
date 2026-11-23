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
  | "search-promoted-knowledge"
  | "search-email"
  | "search-count"
  | "public-web-grounding"
  | "model"
  | "claim-evidence-audit";

export function azureRetryDelayMilliseconds(
  response: Pick<Response, "headers">,
  attempt: number,
) {
  const millisecondHeader =
    response.headers.get("x-ms-retry-after-ms") ??
    response.headers.get("retry-after-ms");
  const millisecondValue = Number(millisecondHeader);
  if (Number.isFinite(millisecondValue) && millisecondValue > 0) {
    return Math.min(60_000, Math.max(1_000, Math.ceil(millisecondValue)));
  }

  const secondsValue = Number(response.headers.get("retry-after"));
  if (Number.isFinite(secondsValue) && secondsValue > 0) {
    return Math.min(60_000, Math.max(1_000, Math.ceil(secondsValue * 1_000)));
  }

  return Math.min(60_000, 20_000 * (2 ** Math.max(0, attempt)));
}

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

export function isTransientAzureRequestFailure(error: unknown) {
  if (error instanceof AzureRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  if (!(error instanceof Error)) return false;
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error.name === "TypeError"
  );
}

export async function retryTransientAzureOperation<T>(
  operation: () => Promise<T>,
  options: {
    requestId: string;
    operation: string;
    maximumAttempts?: number;
    delayMilliseconds?: number;
  },
) {
  const maximumAttempts = Math.max(1, options.maximumAttempts ?? 2);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts || !isTransientAzureRequestFailure(error)) throw error;

      const delayMilliseconds = Math.max(250, options.delayMilliseconds ?? 750);
      console.warn("Helmonic transient dependency failure; retrying internally", {
        requestId: options.requestId,
        operation: options.operation,
        attempt,
        maximumAttempts,
        delayMilliseconds,
        errorType: error instanceof Error ? error.name : "UnknownError",
        diagnostic: safeAzureRequestDiagnostic(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    }
  }

  throw lastError;
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
