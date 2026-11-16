import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sendRfiChangeEmail } from "../../src/lib/tender-intelligence/odoo-rfi-email.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence");
const reportRoot = path.join(artifactRoot, "rfi-change-reports");
const deliveryPath = path.join(reportRoot, "latest-email-delivery.json");
const report = JSON.parse(await readFile(path.join(reportRoot, "latest.json"), "utf8"));
const bodyHtml = await readFile(path.join(reportRoot, "latest-email.html"), "utf8");

let priorDelivery;
try {
  priorDelivery = JSON.parse(await readFile(deliveryPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (priorDelivery?.status === "sent" && priorDelivery?.runId === report.runId) {
  console.log(`TENDER_INTELLIGENCE_RFI_EMAIL_JSON=${JSON.stringify({ ...priorDelivery, status: "already-sent" })}`);
  process.exit(0);
}

const newConfirmed = Number(report.counts?.newlyConfirmedAcousticRfis ?? 0);
const newRfis = Number(report.counts?.newRfis ?? 0);
const failed = Number(report.counts?.odooFailures ?? 0);
const odooProofMissing = report.odoo?.currentRun !== true;
const subject = odooProofMissing
  ? "Helmonic RFI check needs attention — Odoo sync proof missing"
  : failed > 0
  ? `Helmonic RFI check needs attention — ${failed} Odoo failure(s)`
  : newConfirmed > 0 || newRfis > 0
    ? `Helmonic RFI update — ${newConfirmed} newly acoustic-confirmed, ${newRfis} new`
    : "Helmonic daily RFI check complete — no new RFIs";

await mkdir(reportRoot, { recursive: true });
try {
  const delivery = await sendRfiChangeEmail({ runId: report.runId, subject, bodyHtml }, {
    enabled: process.env.HELMONIC_RFI_EMAIL_ENABLED === "true",
    baseUrl: process.env.ODOO_BASE_URL,
    database: process.env.ODOO_DATABASE,
    apiKey: process.env.ODOO_API_KEY,
    recipients: process.env.HELMONIC_RFI_EMAIL_RECIPIENTS,
    allowedDomains: process.env.HELMONIC_RFI_EMAIL_ALLOWED_DOMAINS,
    timeoutMs: Number.parseInt(process.env.ODOO_TIMEOUT_MS || "30000", 10),
  });
  await writeFile(deliveryPath, `${JSON.stringify(delivery, null, 2)}\n`, "utf8");
  console.log(`TENDER_INTELLIGENCE_RFI_EMAIL_JSON=${JSON.stringify(delivery)}`);
} catch (error) {
  const delivery = {
    status: "failed",
    runId: report.runId,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "Unknown RFI email delivery failure",
  };
  await writeFile(deliveryPath, `${JSON.stringify(delivery, null, 2)}\n`, "utf8");
  console.error(`TENDER_INTELLIGENCE_RFI_EMAIL_JSON=${JSON.stringify(delivery)}`);
  throw error;
}
