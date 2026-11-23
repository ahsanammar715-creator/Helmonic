const { ManagedIdentityCredential } = require("@azure/identity");
const { Client } = require("pg");

const oldRole = "uami-helmonic-p1b-bootstrap-001";
const permanentRole = "ammar.ahsan@smartstudioinc.com";

async function main() {
  const credential = new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID);
  const token = await credential.getToken(
    "https://ossrdbms-aad.database.windows.net/.default",
  );
  const client = new Client({
    host: process.env.AZURE_POSTGRES_HOST,
    port: 5432,
    database: process.env.AZURE_POSTGRES_DATABASE,
    user: process.env.CLEANUP_DB_USER,
    password: token.token,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    const currentRole = process.env.CLEANUP_DB_USER.replace(/"/g, '""');
    await client.query(`grant "${oldRole}" to "${currentRole}"`);
    await client.query(`grant "${permanentRole}" to "${currentRole}"`);
    await client.query(`reassign owned by "${oldRole}" to "${permanentRole}"`);
    const ownership = await client.query(
      `select
         (select count(*)::int from pg_catalog.pg_tables where tableowner = $1) as tables,
         (select count(*)::int
          from pg_catalog.pg_namespace n join pg_catalog.pg_roles r on r.oid = n.nspowner
          where r.rolname = $1) as schemas`,
      [oldRole],
    );
    console.log(JSON.stringify({ status: "complete", remainingOwnership: ownership.rows[0] }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : "ownership-recovery-failed" }));
  process.exitCode = 1;
});
