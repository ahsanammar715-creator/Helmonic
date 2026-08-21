import "server-only";

import { getAzureAccessToken } from "@/lib/server/azure-credential";
import {
  getRuntimeConfig,
  type ReadinessCheckName,
  type RuntimeConfig,
} from "@/lib/server/config";
import { checkPostgres } from "@/lib/server/postgres";
import { countSearchDocuments } from "@/lib/server/search";

type CheckResult = {
  ok: boolean;
  detail?: string;
};

type ReadinessResult = {
  ok: boolean;
  checkedAt: string;
  checks: Partial<Record<ReadinessCheckName | "runtime", CheckResult>>;
};

let cached: { expiresAt: number; value: ReadinessResult } | undefined;

async function checkBlob(config: RuntimeConfig) {
  if (!config.storage.accountName) {
    throw new Error("Blob Storage is not configured");
  }

  const token = await getAzureAccessToken("https://storage.azure.com/.default");
  const response = await fetch(
    `https://${config.storage.accountName}.blob.core.windows.net/?comp=list&maxresults=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-version": "2023-11-03",
        "x-ms-date": new Date().toUTCString(),
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Blob readiness request failed with status ${response.status}`);
  }
}

async function checkKeyVault(config: RuntimeConfig) {
  if (!config.keyVault.url) {
    throw new Error("Key Vault is not configured");
  }

  const token = await getAzureAccessToken("https://vault.azure.net/.default");
  const response = await fetch(`${config.keyVault.url}/secrets?api-version=7.4&maxresults=1`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-client-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
  });

  if (!response.ok) {
    throw new Error(`Key Vault readiness request failed with status ${response.status}`);
  }
}

async function runCheck(name: ReadinessCheckName, config: RuntimeConfig) {
  switch (name) {
    case "search": {
      const count = await countSearchDocuments(config);
      return { ok: true, detail: `${count} indexed chunks` };
    }
    case "postgres":
      await checkPostgres(config);
      return { ok: true };
    case "blob":
      await checkBlob(config);
      return { ok: true };
    case "keyvault":
      await checkKeyVault(config);
      return { ok: true };
    case "model":
      if (!config.model.endpoint || !config.model.deployment) {
        throw new Error("Azure model is not configured");
      }
      await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
      return { ok: true, detail: "configuration and identity token ready" };
  }
}

function publicFailure(error: unknown) {
  if (error instanceof Error && error.message.includes("not configured")) {
    return error.message;
  }

  return "dependency check failed";
}

export async function getReadiness(): Promise<ReadinessResult> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const config = getRuntimeConfig();
  const checks: ReadinessResult["checks"] = {
    runtime: {
      ok: config.enabled,
      detail: config.enabled ? undefined : "HELMONIC_RUNTIME is not enabled",
    },
  };

  if (!config.enabled) {
    const value: ReadinessResult = {
      ok: false,
      checkedAt: new Date().toISOString(),
      checks,
    };
    cached = { expiresAt: Date.now() + 20_000, value };
    return value;
  }

  const outcomes = await Promise.all(
    config.readiness.map(async (name) => {
      try {
        return [name, await runCheck(name, config)] as const;
      } catch (error) {
        console.error("Helmonic readiness dependency failed", {
          dependency: name,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        return [name, { ok: false, detail: publicFailure(error) }] as const;
      }
    }),
  );

  for (const [name, result] of outcomes) checks[name] = result;

  const value: ReadinessResult = {
    ok: Object.values(checks).every((result) => result?.ok),
    checkedAt: new Date().toISOString(),
    checks,
  };

  cached = { expiresAt: Date.now() + 20_000, value };
  return value;
}
