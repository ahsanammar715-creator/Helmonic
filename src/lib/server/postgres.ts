import "server-only";

import { Client } from "pg";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

export async function checkPostgres(config: RuntimeConfig) {
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
    application_name: "helmonic-consult-readiness",
  });

  try {
    await client.connect();
    await client.query("select 1 as ready");
  } finally {
    await client.end().catch(() => undefined);
  }
}
