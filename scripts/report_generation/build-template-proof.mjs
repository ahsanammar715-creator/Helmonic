import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildGroundedReportDocx } from "../../src/lib/consult/reports/docx.ts";

const templatePath = process.env.HELMONIC_REPORT_TEMPLATE_LOCAL_PATH;
if (!templatePath) throw new Error("Set HELMONIC_REPORT_TEMPLATE_LOCAL_PATH to the approved Gibson DOCX master.");
const outputDirectory = process.env.HELMONIC_REPORT_PROOF_DIRECTORY ?? path.resolve("local-artifacts/report-generation");
const outputPath = path.join(outputDirectory, "template-grounding-proof.docx");

const citations = [
  { id: "proof-d1", sourceId: "proof-source-1", title: "Project acoustic brief", pageNumber: 4, excerpt: "The project brief requires an airborne sound-insulation assessment between the identified noise-sensitive spaces.", citationNamespace: "D", marker: "D1" },
  { id: "proof-s1", sourceId: "proof-standard-1", title: "Approved acoustic standard", pageNumber: 12, excerpt: "The approved standard defines the project assessment method and reporting terminology.", citationNamespace: "S", marker: "S1" },
];
const headings = ["Executive Summary", "Project Information", "Introduction", "Acoustic Performance Specification", "Inward Noise and Building Envelope Assessment", "Internal Sound Insulation", "Room Acoustics", "Building Services Noise", "Construction Inspection and Commissioning"];
const plan = {
  schemaVersion: 1,
  reportId: "local-template-proof",
  createdAt: new Date().toISOString(),
  requestedByObjectId: "local-verification",
  instruction: "Create a grounded acoustic report using the approved iAcoustics master.",
  metadata: { reportTitle: "Acoustic Design Report", projectName: "Template Verification Project", projectSubtitle: "Local generation proof", address: "Dublin, Ireland", client: "Verification Client", projectNumber: "IAC-VERIFY-001", documentNumber: "IAC-VERIFY-RP-001", revision: "P01", issueDate: "25 September 2026" },
  sections: headings.map((heading, index) => ({ heading, paragraphs: index === 0 ? ["The report is grounded in the supplied project brief and approved assessment standard. [D1] [S1]"] : index === 5 ? ["The airborne sound-insulation assessment addresses the identified noise-sensitive adjacencies. [D1]"] : [] })),
  citations,
  supplementaryAttachments: [{ originalFileName: "supplementary-drawing.pdf", contentType: "application/pdf", byteLength: 12_345, sha256: "a".repeat(64), evidenceStatus: "stored-only" }],
};

await mkdir(outputDirectory, { recursive: true });
const output = buildGroundedReportDocx(new Uint8Array(await readFile(templatePath)), plan);
await writeFile(outputPath, output);
process.stdout.write(`${outputPath}\n`);
