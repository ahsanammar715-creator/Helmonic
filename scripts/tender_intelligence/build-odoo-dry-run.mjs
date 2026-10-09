import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOdooDryRun,
  summarizeOdooDryRun,
} from "../../src/lib/tender-intelligence/odoo-payload.ts";
import { ODOO_TENDER_FIELD_CONTRACT } from "../../src/lib/tender-intelligence/odoo-field-contract.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const statePath = path.join(artifactRoot, "document-proven", "pipeline-state.json");
const state = JSON.parse(await readFile(statePath, "utf8"));
const payloads = buildOdooDryRun(state.opportunities ?? []);
const summary = summarizeOdooDryRun(payloads);
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(artifactRoot, "odoo-dry-runs", timestamp);
const payloadPath = path.join(outputDirectory, "odoo-lead-upserts.json");
const summaryPath = path.join(outputDirectory, "summary.json");
const fieldContractPath = path.join(outputDirectory, "field-contract.json");

await mkdir(outputDirectory, { recursive: true });
await writeFile(payloadPath, `${JSON.stringify(payloads, null, 2)}\n`, "utf8");
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(fieldContractPath, `${JSON.stringify({
  model: "crm.lead",
  operation: "upsert",
  requiredUniqueField: "x_helmonic_external_id",
  note: "Technical custom-field names must be confirmed in the Odoo test database before any write is enabled.",
  standardFields: [
    "name", "description", "type", "team_id", "user_id", "stage_id", "priority",
    "partner_id", "partner_name", "contact_name", "email_from", "phone", "function", "street",
    "date_deadline", "campaign_id", "medium_id", "source_id",
  ],
  customFields: ODOO_TENDER_FIELD_CONTRACT,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...summary, payloadPath, summaryPath, fieldContractPath }, null, 2));
