import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hydrateTenderArtifacts } from "../../src/lib/tender-intelligence/blob-artifacts.ts";
import { sendRfiChangeEmail } from "../../src/lib/tender-intelligence/odoo-rfi-email.ts";
import {
  buildRfiChangeReport,
  rfiChangeReportEmailHtml,
} from "../../src/lib/tender-intelligence/rfi-change-report.ts";

const validationFlag = process.argv.includes("--validation");
const recipientArgument = process.argv.find((argument) => argument.startsWith("--recipient="))?.slice("--recipient=".length);

if (!validationFlag && process.env.HELMONIC_RFI_EMAIL_VALIDATION_ENABLED !== "true") {
  throw new Error("RFI email validation is disabled.");
}

const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "helmonic-rfi-email-validation-"));
try {
  const hydration = await hydrateTenderArtifacts(artifactRoot);
  if (!hydration.enabled || hydration.downloaded === 0) {
    throw new Error("RFI email validation could not hydrate the durable Tender Intelligence artifacts.");
  }
  const state = JSON.parse(await readFile(
    path.join(artifactRoot, "document-proven", "pipeline-state.json"),
    "utf8",
  ));
  const odooSync = JSON.parse(await readFile(
    path.join(artifactRoot, "odoo-sync-runs", "latest-summary.json"),
    "utf8",
  ));
  const now = new Date().toISOString();
  const runId = `validation-${now.replaceAll(":", "-")}`;
  const records = state.opportunities ?? [];
  const report = buildRfiChangeReport({
    currentRecords: records,
    priorRecords: records,
    runId,
    startedAt: now,
    completedAt: now,
    odooSync,
  });
  const notice = [
    '<div style="padding:12px 16px;background:#fff4ce;border:1px solid #e6b800;margin-bottom:16px">',
    "<strong>Validation email:</strong> delivery and formatting test only. ",
    "No sources were rescanned and no Odoo lead records were changed.",
    "</div>",
  ].join("");
  const delivery = await sendRfiChangeEmail({
    runId,
    subject: "[Validation] Helmonic daily RFI checker email",
    bodyHtml: `${notice}${rfiChangeReportEmailHtml(report)}`,
  }, {
    enabled: true,
    baseUrl: process.env.ODOO_BASE_URL,
    database: process.env.ODOO_DATABASE,
    apiKey: process.env.ODOO_API_KEY,
    recipients: recipientArgument || process.env.HELMONIC_RFI_EMAIL_RECIPIENTS,
    allowedDomains: process.env.HELMONIC_RFI_EMAIL_ALLOWED_DOMAINS,
    timeoutMs: Number.parseInt(process.env.ODOO_TIMEOUT_MS || "30000", 10),
  });
  console.log(JSON.stringify({ hydration, reportSummary: report.summary, delivery }, null, 2));
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}
