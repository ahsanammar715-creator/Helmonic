import { createHash } from "node:crypto";

import {
  reportSectionHeadings,
  type GroundedReportPlan,
  type ReportMetadata,
  type SupplementaryAttachment,
} from "./types.ts";
import type { ConsultCitation } from "../types.ts";
import { validateDocumentAnswerCitations } from "../model-policy.ts";

export const reportModelEvidenceCharacterBudget = 12_000;
export const reportModelMaximumCompletionTokens = 4_800;
export const reportModelReasoningEffort = "low" as const;
export const reportExecutiveSummaryMaximumParagraphs = 2;
export const reportExecutiveSummaryMaximumParagraphCharacters = 430;

export type GroundedContentFilterResult = {
  payload: unknown;
  removedParagraphCount: number;
  removedTableRowCount: number;
  removedTableCount: number;
};

function reportEvidenceLength(citation: ConsultCitation) {
  const title = citation.citationNamespace === "B" ? "Approved book source" : citation.title;
  return `[${citation.marker ?? "D"}] ${title}\n${citation.excerpt}\n\n`.length;
}

export function selectReportModelCitations(
  citations: ConsultCitation[],
  maximumCharacters = reportModelEvidenceCharacterBudget,
) {
  if (maximumCharacters <= 0) return [];
  const bySource = new Map<string, ConsultCitation[]>();
  for (const citation of citations) {
    const queue = bySource.get(citation.sourceId) ?? [];
    queue.push(citation);
    bySource.set(citation.sourceId, queue);
  }
  const selected: ConsultCitation[] = [];
  let usedCharacters = 0;
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const queue of bySource.values()) {
      const citation = queue.shift();
      if (!citation) continue;
      remaining = true;
      const length = reportEvidenceLength(citation);
      if (usedCharacters + length > maximumCharacters) continue;
      selected.push(citation);
      usedCharacters += length;
    }
  }
  return selected;
}

export function filterUngroundedReportContent(
  sectionPayload: unknown,
  citations: ConsultCitation[],
): GroundedContentFilterResult {
  if (!sectionPayload || typeof sectionPayload !== "object") {
    return {
      payload: sectionPayload,
      removedParagraphCount: 0,
      removedTableRowCount: 0,
      removedTableCount: 0,
    };
  }
  const candidate = sectionPayload as { sections?: unknown };
  if (!Array.isArray(candidate.sections)) {
    return {
      payload: sectionPayload,
      removedParagraphCount: 0,
      removedTableRowCount: 0,
      removedTableCount: 0,
    };
  }

  let removedParagraphCount = 0;
  let removedTableRowCount = 0;
  let removedTableCount = 0;
  const sections = candidate.sections.map((section) => {
    if (!section || typeof section !== "object") return section;
    const item = section as { paragraphs?: unknown; tables?: unknown };
    const paragraphs = Array.isArray(item.paragraphs)
      ? item.paragraphs.filter((paragraph) => {
          if (typeof paragraph !== "string") return true;
          const keep = validateDocumentAnswerCitations(paragraph, citations).valid;
          if (!keep) removedParagraphCount += 1;
          return keep;
        })
      : item.paragraphs;
    const tables = Array.isArray(item.tables)
      ? item.tables.flatMap((table) => {
          if (!table || typeof table !== "object") return [table];
          const tableItem = table as { rows?: unknown };
          if (!Array.isArray(tableItem.rows)) return [table];
          const rows = tableItem.rows.filter((row) => {
            if (!Array.isArray(row) || row.some((cell) => typeof cell !== "string")) return true;
            const keep = validateDocumentAnswerCitations(row.join(" "), citations).valid;
            if (!keep) removedTableRowCount += 1;
            return keep;
          });
          if (rows.length === 0) {
            removedTableCount += 1;
            return [];
          }
          return [{ ...tableItem, rows }];
        })
      : item.tables;
    return { ...item, paragraphs, tables };
  });

  return {
    payload: { ...candidate, sections },
    removedParagraphCount,
    removedTableRowCount,
    removedTableCount,
  };
}

export function reportPayloadClaimText(sectionPayload: unknown) {
  if (!sectionPayload || typeof sectionPayload !== "object") return "";
  const candidate = sectionPayload as { sections?: unknown };
  if (!Array.isArray(candidate.sections)) return "";

  const claims: string[] = [];
  for (const section of candidate.sections) {
    if (!section || typeof section !== "object") continue;
    const item = section as { paragraphs?: unknown; tables?: unknown };
    if (Array.isArray(item.paragraphs)) {
      claims.push(
        ...item.paragraphs.filter(
          (paragraph): paragraph is string => typeof paragraph === "string",
        ),
      );
    }
    if (!Array.isArray(item.tables)) continue;
    for (const table of item.tables) {
      if (!table || typeof table !== "object") continue;
      const rows = (table as { rows?: unknown }).rows;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!Array.isArray(row) || row.some((cell) => typeof cell !== "string")) continue;
        claims.push(row.join(" | "));
      }
    }
  }
  return claims.filter((claim) => claim.trim().length > 0).join("\n\n");
}

function limitedText(value: unknown, label: string, maximum: number, required = false) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (required && !normalized) throw new Error(`report-${label}-required`);
  if (normalized.length > maximum) throw new Error(`report-${label}-too-long`);
  return normalized;
}

function compactGroundedParagraph(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  const markers = [...new Set(value.match(/\[(?:D|S|B|A|E)\d+\]/g) ?? [])];
  const prose = value.replace(/\[(?:D|S|B|A|E)\d+\]/g, "").replace(/\s+/g, " ").trim();
  const suffix = markers.length ? ` ${markers.join(" ")}` : "";
  const allowance = Math.max(80, maximum - suffix.length - 1);
  const candidate = prose.slice(0, allowance);
  const sentenceEnd = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "));
  const safeProse = (sentenceEnd >= Math.floor(allowance * 0.55)
    ? candidate.slice(0, sentenceEnd + 1)
    : candidate.replace(/[,;:\s]+\S*$/, "").trimEnd())
    .replace(/[,:;\s]+$/, "");
  return `${safeProse}.${suffix}`.trim();
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
    const item = section as { heading?: unknown; paragraphs?: unknown; tables?: unknown };
    const heading = limitedText(item.heading, `section-${index}-heading`, 120, true);
    if (!reportSectionHeadings.includes(heading as never)) throw new Error(`report-section-${index}-unknown`);
    if (headings.has(heading)) throw new Error(`report-section-${index}-duplicate`);
    headings.add(heading);
    if (!Array.isArray(item.paragraphs)) throw new Error(`report-section-${index}-paragraphs-invalid`);
    let paragraphs = item.paragraphs.map((paragraph, paragraphIndex) =>
      limitedText(paragraph, `section-${index}-paragraph-${paragraphIndex}`, 3_500, true),
    );
    for (const paragraph of paragraphs) {
      const validation = validateDocumentAnswerCitations(paragraph, input.citations);
      if (!validation.valid) {
        throw new Error(`report-section-${index}-citation-invalid:${validation.errors.join(" ")}`);
      }
    }
    const rawTables = item.tables ?? [];
    if (!Array.isArray(rawTables)) throw new Error(`report-section-${index}-tables-invalid`);
    if (heading === "Executive Summary" && rawTables.length > 0) {
      throw new Error("report-executive-summary-tables-not-supported");
    }
    if (heading === "Executive Summary") {
      paragraphs = paragraphs
        .slice(0, reportExecutiveSummaryMaximumParagraphs)
        .map((paragraph) => compactGroundedParagraph(paragraph, reportExecutiveSummaryMaximumParagraphCharacters));
    }
    if (rawTables.length > 6) throw new Error(`report-section-${index}-tables-too-many`);
    const tables = rawTables.map((table, tableIndex) => {
      if (!table || typeof table !== "object") {
        throw new Error(`report-section-${index}-table-${tableIndex}-invalid`);
      }
      const candidate = table as { title?: unknown; columns?: unknown; rows?: unknown };
      const title = limitedText(candidate.title, `section-${index}-table-${tableIndex}-title`, 180, true);
      if (!Array.isArray(candidate.columns) || candidate.columns.length < 2 || candidate.columns.length > 6) {
        throw new Error(`report-section-${index}-table-${tableIndex}-columns-invalid`);
      }
      const columns = candidate.columns.map((column, columnIndex) =>
        limitedText(column, `section-${index}-table-${tableIndex}-column-${columnIndex}`, 100, true),
      );
      if (!Array.isArray(candidate.rows) || candidate.rows.length === 0 || candidate.rows.length > 30) {
        throw new Error(`report-section-${index}-table-${tableIndex}-rows-invalid`);
      }
      const rows = candidate.rows.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== columns.length) {
          throw new Error(`report-section-${index}-table-${tableIndex}-row-${rowIndex}-invalid`);
        }
        const cells = row.map((cell, cellIndex) =>
          limitedText(cell, `section-${index}-table-${tableIndex}-row-${rowIndex}-cell-${cellIndex}`, 700, true),
        );
        const validation = validateDocumentAnswerCitations(cells.join(" "), input.citations);
        if (!validation.valid) {
          throw new Error(
            `report-section-${index}-table-${tableIndex}-row-${rowIndex}-citation-invalid:${validation.errors.join(" ")}`,
          );
        }
        return cells;
      });
      return { title, columns, rows };
    });
    return { heading: heading as (typeof reportSectionHeadings)[number], paragraphs, tables };
  });
  const byHeading = new Map(supplied.map((section) => [section.heading, section]));
  const sections = reportSectionHeadings.map(
    (heading) => byHeading.get(heading) ?? { heading, paragraphs: [], tables: [] },
  );
  const usedMarkers = new Set(
    sections
      .flatMap((section) => [
        ...section.paragraphs,
        ...section.tables.flatMap((table) => table.rows.flat()),
      ])
      .flatMap((text) => text.match(/\[(?:D|S|B|A|E)\d+\]/g) ?? []),
  );
  const usedCitations = input.citations.filter((citation) => {
    const marker = `[${citation.marker ?? citation.citationNamespace ?? "D"}]`;
    return usedMarkers.has(marker);
  });
  return {
    schemaVersion: 2,
    reportId: input.reportId,
    createdAt: new Date().toISOString(),
    requestedByObjectId: input.requestedByObjectId,
    instruction: limitedText(input.instruction, "instruction", 2_000, true),
    metadata: input.metadata,
    sections,
    citations: usedCitations,
    supplementaryAttachments: input.supplementaryAttachments,
  };
}

export function sha256Attachment(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
