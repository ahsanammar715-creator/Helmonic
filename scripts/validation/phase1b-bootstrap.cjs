const { ManagedIdentityCredential } = require("@azure/identity");
const { Client } = require("pg");

async function sourceFile(path) {
  const response = await fetch(
    `https://raw.githubusercontent.com/ahsanammar715-creator/Helmonic/${process.env.HELMONIC_SOURCE_REF}/${path}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error(`source-${path}-${response.status}`);
  return response.text();
}

async function main() {
  const credential = new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID);
  const [migration, indexSchema, postgresToken] = await Promise.all([
    sourceFile("database/migrations/001_phase1b_consult.sql"),
    sourceFile("scripts/ingestion/session-index-schema.json"),
    credential.getToken("https://ossrdbms-aad.database.windows.net/.default"),
  ]);

  const client = new Client({
    host: process.env.AZURE_POSTGRES_HOST,
    port: 5432,
    database: process.env.AZURE_POSTGRES_DATABASE,
    user: process.env.BOOTSTRAP_DB_USER,
    password: postgresToken.token,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  await client.query(migration);
  const tables = await client.query(
    `select count(*)::int as count
     from information_schema.tables
     where table_schema = 'consult'
       and table_name in (
         'folders', 'conversations', 'documents', 'document_versions',
         'conversation_documents', 'ingestion_jobs', 'messages',
         'message_citations', 'audit_events'
       )`,
  );
  const grants = await client.query(
    `select count(*)::int as count from (
       select table_name
       from information_schema.role_table_grants
       where table_schema = 'consult'
         and grantee = 'ca-helmonic-consult-dev-002'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
       group by table_name
       having count(distinct privilege_type) = 4
     ) granted_tables`,
  );
  await client.end();

  const storageToken = await credential.getToken("https://storage.azure.com/.default");
  const storageResponse = await fetch(
    `https://${process.env.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/${process.env.AZURE_STORAGE_SESSION_CONTAINER}?restype=container`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${storageToken.token}`,
        "x-ms-date": new Date().toUTCString(),
        "x-ms-version": "2023-11-03",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (![201, 409].includes(storageResponse.status)) {
    throw new Error(`storage-container-${storageResponse.status}`);
  }

  const searchToken = await credential.getToken("https://search.azure.com/.default");
  const searchResponse = await fetch(
    `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${process.env.AZURE_SEARCH_SESSION_INDEX}?api-version=${process.env.AZURE_SEARCH_API_VERSION}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${searchToken.token}`,
        "Content-Type": "application/json",
      },
      body: indexSchema,
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (![200, 201, 204].includes(searchResponse.status)) {
    throw new Error(`search-index-${searchResponse.status}-${await searchResponse.text()}`);
  }

  console.log(
    JSON.stringify({
      status: "complete",
      consultTables: tables.rows[0].count,
      runtimeGrantedTables: grants.rows[0].count,
      blobContainerStatus: storageResponse.status,
      searchIndexStatus: searchResponse.status,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "bootstrap-failed",
    }),
  );
  process.exitCode = 1;
});
