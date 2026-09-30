import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncOdooLeads } from "../../src/lib/tender-intelligence/odoo-client.ts";
import { buildOdooDryRun } from "../../src/lib/tender-intelligence/odoo-payload.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const state = JSON.parse(await readFile(path.join(artifactRoot, "document-proven", "pipeline-state.json"), "utf8"));
const payloads = buildOdooDryRun(state.opportunities ?? []);
const result = await syncOdooLeads(payloads, {
  enabled: process.env.HELMONIC_ODOO_SYNC_ENABLED === "true",
  baseUrl: process.env.ODOO_BASE_URL,
  database: process.env.ODOO_DATABASE,
  apiKey: process.env.ODOO_API_KEY,
  model: process.env.ODOO_MODEL || "crm.lead",
  externalIdField: process.env.ODOO_EXTERNAL_ID_FIELD || "x_helmonic_external_id",
  timeoutMs: Number.parseInt(process.env.ODOO_TIMEOUT_MS || "30000", 10),
});
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(artifactRoot, "odoo-sync-runs", timestamp);
await mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "summary.json");
await writeFile(outputPath, `${JSON.stringify({ ...result, outputPath }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...result, outputPath }, null, 2));
