import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assignOdooRfiOwners } from "../../src/lib/tender-intelligence/odoo-client.ts";
import { buildOdooDryRun } from "../../src/lib/tender-intelligence/odoo-payload.ts";
import { recordsForOdooSync } from "../../src/lib/tender-intelligence/odoo-record-source.ts";
import { hydrateTenderArtifacts } from "../../src/lib/tender-intelligence/blob-artifacts.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");

const hydration = await hydrateTenderArtifacts(artifactRoot);
if (!hydration.enabled || hydration.downloaded === 0) {
  throw new Error("RFI assignment refused: the durable completed ledger could not be hydrated. No Odoo assignments were written.");
}
const state = JSON.parse(await readFile(path.join(artifactRoot, "document-proven", "pipeline-state.json"), "utf8"));
const ledger = JSON.parse(await readFile(path.join(artifactRoot, "document-proven", "confirmed-ledger.json"), "utf8"));
const audit = JSON.parse(await readFile(path.join(artifactRoot, "document-proven", "latest-audit.json"), "utf8"));
const sourceRecords = recordsForOdooSync({
  state,
  ledger,
  audit,
  useCompletedLedger: true,
  maxCompletedLedgerAgeHours: Number.parseFloat(process.env.HELMONIC_COMPLETED_LEDGER_MAX_AGE_HOURS || "36"),
});
const singleOwnerRelationships = new Map(sourceRecords
  .filter((record) => record.emailRelationshipStatus === "verified-single-owner"
    && (record.emailRelationshipOwner === "Glen" || record.emailRelationshipOwner === "Owen"))
  .map((record) => [
    record.crmExternalId,
    record.emailRelationshipOwner === "Glen" ? "Glen Plunkett" : "Eoghan Tyrrell",
  ]));
const payloads = buildOdooDryRun(sourceRecords).map((payload) => {
  const matchedConsultant = singleOwnerRelationships.get(payload.matchValue);
  if (!matchedConsultant) return payload;
  return {
    ...payload,
    values: {
      ...payload.values,
      x_assigned_person: matchedConsultant,
    },
  };
});
const integerEnv = (name) => {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const result = await assignOdooRfiOwners(payloads, {
  enabled: process.env.HELMONIC_ODOO_ASSIGN_RFI_OWNERS === "true",
  baseUrl: process.env.ODOO_BASE_URL,
  expectedBaseUrl: process.env.HELMONIC_ODOO_EXPECTED_BASE_URL,
  database: process.env.ODOO_DATABASE,
  apiKey: process.env.ODOO_API_KEY,
  model: process.env.ODOO_MODEL || "crm.lead",
  externalIdField: process.env.ODOO_EXTERNAL_ID_FIELD || "x_helmonic_external_id",
  glenUserId: integerEnv("ODOO_GLEN_USER_ID"),
  eoghanUserId: integerEnv("ODOO_EOGHAN_USER_ID"),
  assignNativeOwners: true,
  requestIntervalMs: Number.parseInt(process.env.ODOO_REQUEST_INTERVAL_MS || "250", 10),
  timeoutMs: Number.parseInt(process.env.ODOO_TIMEOUT_MS || "30000", 10),
});

console.log(`ODOO_RFI_ASSIGNMENT_JSON=${JSON.stringify({ ...result, artifactHydration: hydration })}`);
