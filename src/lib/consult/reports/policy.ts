import { createHash } from "node:crypto";

import {
  reportSectionHeadings,
  type GroundedReportPlan,
  type ReportMetadata,
  type SupplementaryAttachment,
} from "./types.ts";
import type { ConsultCitation } from "../types.ts";
import { validateDocumentAnswerCitations } from "../model-policy.ts";

function limitedText(value: unknown, label: string, maximum: number, required = false) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (required && !normalized) throw new Error(`report-${label}-required`);
  if (normalized.length > maximum) throw new Error(`report-${label}-too-long`);
  return normalized;
}

export function validateReportMetadata(value: unknown): ReportMetadata {
  if (!value || typeof value !== "object") throw new Error("report-metadata-required");
  const input = value as Record<string, unknown>;
  const issueDate =
    limitedText(input.issueDate, "issue-date", 40) || new Date().toISOString().slice(0, 10);
  return {
    reportTitle: limitedText(input.reportTitle, "title", 180, true),
    projectName: limitedText(input.projectName, "project-name", 180, true),
    projectSubtitle: limitedText(input.projectSubtitle, "project-subtitle", 180) || undefined,
    address: limitedText(input.address, "address", 300) || undefined,
    client: limitedText(input.client, "client", 180) || undefined,
    projectNumber: limitedText(input.projectNumber, "project-number", 80) || undefined,
    documentNumber: limitedText(input.documentNumber, "document-number", 120) || undefined,
    revision: limitedText(input.revision, "revision", 40) || undefined,
    issueDate,
  };
}

export function buildGroundedReportPlan(input: {
  reportId: string;
  requestedByObjectId: string;
  instruction: string;
  metadata: ReportMetadata;
  sectionPayload: unknown;
  citations: ConsultCitation[];
  supplementaryAttachments: SupplementaryAttachment[];
}): GroundedReportPlan {
  const payload = input.sectionPayload as { sections?: unknown };
  if (!payload || !Array.isArray(payload.sections)) throw new Error("report-model-sections-invalid");
  const headings = new Set<string>();
  const supplied = payload.sections.map((section, index) => {
    if (!section || typeof section !== "object") throw new Error(`report-section-${index}-invalid`);
    const item = section as { heading?: unknown; paragraphs?: unknown };
    const heading = limitedText(item.heading, `section-${index}-heading`, 120, true);
    if (!reportSectionHeadings.includes(heading as never)) throw new Error(`report-section-${index}-unknown`);
    if (headings.has(heading)) throw new Error(`report-section-${index}-duplicate`);
    headings.add(heading);
    if (!Array.isArray(item.paragraphs)) throw new Error(`report-section-${index}-paragraphs-invalid`);
    const paragraphs = item.paragraphs.map((paragraph, paragraphIndex) =>
      limitedText(paragraph, `section-${index}-paragraph-${paragraphIndex}`, 3_500, true),
    );
    for (const paragraph of paragraphs) {
      const validation = validateDocumentAnswerCitations(paragraph, input.citations);
      if (!validation.valid) {
        throw new Error(`report-section-${index}-citation-invalid:${validation.errors.join(" ")}`);
      }
    }
    return { heading: heading as (typeof reportSectionHeadings)[number], paragraphs };
  });
  const byHeading = new Map(supplied.map((section) => [section.heading, section]));
  const sections = reportSectionHeadings.map(
    (heading) => byHeading.get(heading) ?? { heading, paragraphs: [] },
  );
  return {
    schemaVersion: 1,
    reportId: input.reportId,
    createdAt: new Date().toISOString(),
    requestedByObjectId: input.requestedByObjectId,
    instruction: limitedText(input.instruction, "instruction", 2_000, true),
    metadata: input.metadata,
    sections,
    citations: input.citations,
    supplementaryAttachments: input.supplementaryAttachments,
  };
}

export function sha256Attachment(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
