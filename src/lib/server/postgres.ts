import "server-only";

import { Client } from "pg";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

export async function withPostgresClient<T>(
  config: RuntimeConfig,
  applicationName: string,
  operation: (client: Client) => Promise<T>,
) {
  const { host, database, user, port } = config.postgres;

  if (!host || !database || !user) {
    throw new Error("PostgreSQL is not configured");
  }

  const password = await getAzureAccessToken(
    "https://ossrdbms-aad.database.windows.net/.default",
  );
  const client = new Client({
    host,
    database,
    user,
    port,
    password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 6_000,
    statement_timeout: 3_000,
    application_name: applicationName,
  });

  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function checkPostgres(config: RuntimeConfig) {
  await withPostgresClient(config, "helmonic-consult-readiness", async (client) => {
    await client.query("select 1 as ready");
  });
}
