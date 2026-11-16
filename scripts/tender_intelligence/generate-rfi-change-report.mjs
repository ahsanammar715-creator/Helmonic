import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRfiChangeReport,
  rfiChangeReportCsv,
  rfiChangeReportEmailHtml,
} from "../../src/lib/tender-intelligence/rfi-change-report.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const runId = process.env.HELMONIC_AUTOMATION_RUN_ID || new Date().toISOString().replaceAll(":", "-");
const startedAt = process.env.HELMONIC_AUTOMATION_STARTED_AT || new Date().toISOString();
const runRoot = path.join(artifactRoot, "automation-runs", runId);
const reportRoot = path.join(artifactRoot, "rfi-change-reports");

async function jsonIfPresent(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const currentState = await jsonIfPresent(
  path.join(artifactRoot, "document-proven", "pipeline-state.json"),
  { opportunities: [] },
);
const priorState = await jsonIfPresent(path.join(runRoot, "prior-pipeline-state.json"), { opportunities: [] });
const odooSync = await jsonIfPresent(path.join(artifactRoot, "odoo-sync-runs", "latest-summary.json"), undefined);
const report = buildRfiChangeReport({
  currentRecords: currentState.opportunities ?? [],
  priorRecords: priorState.opportunities ?? [],
  runId,
  startedAt,
  completedAt: new Date().toISOString(),
  odooSync,
});
const json = `${JSON.stringify(report, null, 2)}\n`;
const csv = rfiChangeReportCsv(report);
const emailHtml = rfiChangeReportEmailHtml(report);

await Promise.all([mkdir(runRoot, { recursive: true }), mkdir(reportRoot, { recursive: true })]);
await Promise.all([
  writeFile(path.join(runRoot, "rfi-change-report.json"), json, "utf8"),
  writeFile(path.join(runRoot, "rfi-change-report.csv"), csv, "utf8"),
  writeFile(path.join(runRoot, "rfi-change-email.html"), emailHtml, "utf8"),
  writeFile(path.join(reportRoot, "latest.json"), json, "utf8"),
  writeFile(path.join(reportRoot, "latest.csv"), csv, "utf8"),
  writeFile(path.join(reportRoot, "latest-email.html"), emailHtml, "utf8"),
]);

console.log(`TENDER_INTELLIGENCE_RFI_CHANGE_JSON=${JSON.stringify(report)}`);
