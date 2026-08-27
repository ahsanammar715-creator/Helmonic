import "server-only";

export type ReadinessCheckName = "search" | "postgres" | "blob" | "keyvault" | "model";

const readinessCheckNames: ReadinessCheckName[] = [
  "search",
  "postgres",
  "blob",
  "keyvault",
  "model",
];

function optional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function withoutTrailingSlash(value: string | undefined) {
  return value?.replace(/\/+$/, "");
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function enabled(name: string) {
  return optional(name) === "true";
}

function reasoningEffort(value: string | undefined) {
  return value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : "high";
}

export function getRuntimeConfig() {
  const readiness = (optional("HELMONIC_READINESS_CHECKS") ?? "search,postgres,blob,keyvault")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ReadinessCheckName =>
      readinessCheckNames.includes(value as ReadinessCheckName),
    );

  return {
    enabled: optional("HELMONIC_RUNTIME") === "azure",
    appVersion:
      optional("HELMONIC_APP_VERSION") ??
      optional("CONTAINER_APP_REVISION") ??
      optional("VERCEL_GIT_COMMIT_SHA") ??
      "development",
    profile: optional("HELMONIC_DEMO_PROFILE") ?? "iAcoustics",
    allowRetrievalOnly: optional("HELMONIC_ALLOW_RETRIEVAL_ONLY") === "true",
    search: {
      endpoint: withoutTrailingSlash(optional("AZURE_SEARCH_ENDPOINT")),
      indexName: optional("AZURE_SEARCH_INDEX"),
      apiVersion: optional("AZURE_SEARCH_API_VERSION") ?? "2025-09-01",
      top: positiveInteger(optional("HELMONIC_SEARCH_TOP"), 4),
    },
    storage: {
      accountName: optional("AZURE_STORAGE_ACCOUNT"),
    },
    keyVault: {
      url: withoutTrailingSlash(optional("AZURE_KEY_VAULT_URL")),
    },
    postgres: {
      host: optional("AZURE_POSTGRES_HOST"),
      database: optional("AZURE_POSTGRES_DATABASE"),
      user: optional("AZURE_POSTGRES_USER"),
      port: positiveInteger(optional("AZURE_POSTGRES_PORT"), 5432),
    },
    serviceBus: {
      namespace: optional("AZURE_SERVICE_BUS_NAMESPACE"),
      queue: optional("AZURE_SERVICE_BUS_QUEUE"),
    },
    phase1b: {
      uploadsEnabled: enabled("HELMONIC_PHASE1B_UPLOADS_ENABLED"),
      foldersEnabled: enabled("HELMONIC_PHASE1B_FOLDERS_ENABLED"),
      generalContextEnabled: enabled("HELMONIC_GENERAL_CONTEXT_ENABLED"),
      sessionBlobContainer:
        optional("AZURE_STORAGE_SESSION_CONTAINER") ?? "consult-session-uploads",
      sessionSearchIndex: optional("AZURE_SEARCH_SESSION_INDEX"),
      generalSearchIndex: optional("AZURE_SEARCH_GENERAL_INDEX"),
      maximumUploadBytes: positiveInteger(
        optional("HELMONIC_MAX_UPLOAD_BYTES"),
        40 * 1024 * 1024,
      ),
      uploadRetentionDays: positiveInteger(
        optional("HELMONIC_UPLOAD_RETENTION_DAYS"),
        30,
      ),
    },
    model: {
      endpoint: withoutTrailingSlash(optional("AZURE_OPENAI_ENDPOINT")),
      deployment: optional("AZURE_OPENAI_DEPLOYMENT"),
      apiVersion: optional("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
      reasoningEffort: reasoningEffort(optional("AZURE_OPENAI_REASONING_EFFORT")),
      maximumCompletionTokens: positiveInteger(
        optional("AZURE_OPENAI_MAX_COMPLETION_TOKENS"),
        2_000,
      ),
      timeoutMilliseconds: positiveInteger(optional("AZURE_OPENAI_TIMEOUT_MS"), 120_000),
    },
    readiness,
  };
}

export type RuntimeConfig = ReturnType<typeof getRuntimeConfig>;

export function getQueryConfigurationErrors(config: RuntimeConfig) {
  const missing: string[] = [];

  if (!config.search.endpoint) missing.push("AZURE_SEARCH_ENDPOINT");
  if (!config.search.indexName) missing.push("AZURE_SEARCH_INDEX");

  const modelPartiallyConfigured = Boolean(config.model.endpoint) !== Boolean(config.model.deployment);
  if (modelPartiallyConfigured) {
    if (!config.model.endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
    if (!config.model.deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");
  }

  if (!config.allowRetrievalOnly && !modelPartiallyConfigured) {
    if (!config.model.endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
    if (!config.model.deployment) missing.push("AZURE_OPENAI_DEPLOYMENT");
  }

  return missing;
}

export function getUploadConfigurationErrors(config: RuntimeConfig) {
  const missing: string[] = [];
  if (!config.enabled) missing.push("HELMONIC_RUNTIME");
  if (!config.phase1b.uploadsEnabled) missing.push("HELMONIC_PHASE1B_UPLOADS_ENABLED");
  if (!config.storage.accountName) missing.push("AZURE_STORAGE_ACCOUNT");
  if (!config.phase1b.sessionSearchIndex) missing.push("AZURE_SEARCH_SESSION_INDEX");
  if (!config.serviceBus.namespace) missing.push("AZURE_SERVICE_BUS_NAMESPACE");
  if (!config.serviceBus.queue) missing.push("AZURE_SERVICE_BUS_QUEUE");
  if (!config.postgres.host) missing.push("AZURE_POSTGRES_HOST");
  if (!config.postgres.database) missing.push("AZURE_POSTGRES_DATABASE");
  if (!config.postgres.user) missing.push("AZURE_POSTGRES_USER");
  return missing;
}
