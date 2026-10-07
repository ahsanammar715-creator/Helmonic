import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hydrateTenderArtifacts } from "../../src/lib/tender-intelligence/blob-artifacts.ts";
import { preflightOdoo, syncOdooLeads } from "../../src/lib/tender-intelligence/odoo-client.ts";
import {
  buildOdooDryRun,
  selectOdooValidationLead,
} from "../../src/lib/tender-intelligence/odoo-payload.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const integerEnv = (name) => {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const config = {
  enabled: process.env.HELMONIC_ODOO_SYNC_ENABLED === "true",
  baseUrl: process.env.ODOO_BASE_URL,
  database: process.env.ODOO_DATABASE,
  apiKey: process.env.ODOO_API_KEY,
  model: process.env.ODOO_MODEL || "crm.lead",
  externalIdField: process.env.ODOO_EXTERNAL_ID_FIELD || "x_helmonic_external_id",
  salesTeamId: integerEnv("ODOO_SALES_TEAM_ID"),
  initialStageId: integerEnv("ODOO_INITIAL_STAGE_ID"),
  glenUserId: integerEnv("ODOO_GLEN_USER_ID"),
  eoghanUserId: integerEnv("ODOO_EOGHAN_USER_ID"),
  timeoutMs: Number.parseInt(process.env.ODOO_TIMEOUT_MS || "30000", 10),
};

const hydration = await hydrateTenderArtifacts(artifactRoot);
const state = JSON.parse(await readFile(path.join(artifactRoot, "document-proven", "pipeline-state.json"), "utf8"));
const selected = selectOdooValidationLead(buildOdooDryRun(state.opportunities ?? []));
const preflight = await preflightOdoo([selected], config);
const sync = await syncOdooLeads([selected], config);
if (sync.attempted > 1 || sync.created + sync.updated > 1) {
  throw new Error("The isolated Odoo validation attempted to touch more than one record.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(artifactRoot, "odoo-one-lead-validations", timestamp);
const outputPath = path.join(outputDirectory, "summary.json");
const summary = {
  mode: config.enabled ? "one-record-write" : "read-only-preflight",
  hydration,
  selectedLead: {
    externalId: selected.matchValue,
    name: selected.values.name,
    quality: selected.values.x_lead_quality,
    pipelineBucket: selected.values.x_pipeline_bucket,
    location: selected.values.x_location,
    sourceSystems: selected.values.x_source_systems,
    evidenceExcerpt: selected.values.x_evidence_excerpt.slice(0, 500),
    assignedPerson: selected.values.x_assigned_person,
  },
  preflight,
  sync,
  outputPath,
};
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
