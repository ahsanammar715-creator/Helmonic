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
    model: {
      endpoint: withoutTrailingSlash(optional("AZURE_OPENAI_ENDPOINT")),
      deployment: optional("AZURE_OPENAI_DEPLOYMENT"),
      apiVersion: optional("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
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
