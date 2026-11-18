import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildGroundedReportDocx } from "../../src/lib/consult/reports/docx.ts";

const templatePath = process.env.HELMONIC_REPORT_TEMPLATE_LOCAL_PATH;
const planPath = process.env.HELMONIC_REPORT_PLAN_PATH;
const outputPath = process.env.HELMONIC_REPORT_PROOF_PATH;

if (!templatePath) throw new Error("Set HELMONIC_REPORT_TEMPLATE_LOCAL_PATH to the approved Gibson DOCX master.");
if (!planPath) throw new Error("Set HELMONIC_REPORT_PLAN_PATH to a grounded report-plan manifest.");
if (!outputPath) throw new Error("Set HELMONIC_REPORT_PROOF_PATH to the QA DOCX output path.");

const plan = JSON.parse(await readFile(planPath, "utf8"));
await mkdir(path.dirname(outputPath), { recursive: true });
const output = buildGroundedReportDocx(new Uint8Array(await readFile(templatePath)), plan);
await writeFile(outputPath, output);
process.stdout.write(`${outputPath}\n`);
