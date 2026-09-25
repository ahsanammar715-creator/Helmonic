import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type { GroundedReportPlan, ReportSectionHeading } from "@/lib/consult/reports/types";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function textOf(node: string) {
  return decodeXml(
    [...node.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]).join(""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function bodyParts(documentXml: string) {
  const match = documentXml.match(/^([\s\S]*?<w:body>)([\s\S]*)(<\/w:body><\/w:document>\s*)$/);
  if (!match) throw new Error("report-template-body-missing");
  const [, open, body, close] = match;
  const nodes: string[] = [];
  let cursor = 0;
  const readNode = (start: number, tag: string) => {
    const tagPattern = new RegExp(`<\\/?w:${tag}\\b[^>]*>`, "g");
    tagPattern.lastIndex = start;
    let depth = 0;
    for (const token of body.matchAll(tagPattern)) {
      if ((token.index ?? -1) < start) continue;
      const value = token[0];
      if (value.startsWith("</")) depth -= 1;
      else if (!value.endsWith("/>")) depth += 1;
      if (depth === 0) return (token.index ?? 0) + value.length;
    }
    throw new Error(`report-template-${tag}-unterminated`);
  };
  while (cursor < body.length) {
    const next = body.slice(cursor).search(/<w:(?:p|tbl|sectPr)\b/);
    if (next < 0) break;
    const start = cursor + next;
    const tag = body.slice(start).match(/^<w:(p|tbl|sectPr)\b/)?.[1];
    if (!tag) throw new Error("report-template-body-node-invalid");
    const end = readNode(start, tag);
    nodes.push(body.slice(start, end));
    cursor = end;
  }
  return { open, nodes, close };
}

function paragraphStyle(node: string) {
  return node.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? "";
}

/** Replace visible text only. All paragraph/run/drawing/section XML remains unchanged. */
function replaceVisibleText(node: string, replacement: string) {
  let used = false;
  return node.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_whole, attributes: string) => {
    const value = used ? "" : escapeXml(replacement);
    used = true;
    return `<w:t${attributes}>${value}</w:t>`;
  });
}

function replaceExactRuns(node: string, replacements: Map<string, string>) {
  return node.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (whole, attributes: string, value: string) => {
    const replacement = replacements.get(decodeXml(value));
    if (replacement === undefined) return whole;
    return `<w:t${attributes}>${escapeXml(replacement)}</w:t>`;
  });
}

function maskVisibleText(xml: string) {
  return xml.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, "$1__DYNAMIC_TEXT__$2");
}

function tagCount(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<w:${tag}\\b`, "g"))].length;
}

function assertProtectedShell(sourceArchive: Record<string, Uint8Array>, outputArchive: Record<string, Uint8Array>) {
  const sourceDocument = strFromU8(sourceArchive["word/document.xml"]);
  const outputDocument = strFromU8(outputArchive["word/document.xml"]);
  if (maskVisibleText(sourceDocument) !== maskVisibleText(outputDocument)) {
    throw new Error("report-template-protected-document-structure-changed");
  }
  for (const tag of ["sectPr", "pgMar", "pgSz", "tbl", "drawing", "pict"] as const) {
    if (tagCount(sourceDocument, tag) !== tagCount(outputDocument, tag)) {
      throw new Error(`report-template-protected-${tag}-count-changed`);
    }
  }
  const mutableParts = new Set(["word/document.xml", "word/footer1.xml"]);
  const sourceParts = Object.keys(sourceArchive).sort();
  const outputParts = Object.keys(outputArchive).sort();
  if (sourceParts.join("\n") !== outputParts.join("\n")) {
    throw new Error("report-template-package-parts-changed");
  }
  for (const part of sourceParts) {
    if (mutableParts.has(part)) continue;
    const source = sourceArchive[part];
    const output = outputArchive[part];
    if (source.byteLength !== output.byteLength || source.some((value, index) => output[index] !== value)) {
      throw new Error(`report-template-protected-part-changed:${part}`);
    }
  }
  const sourceFooter = sourceArchive["word/footer1.xml"];
  const outputFooter = outputArchive["word/footer1.xml"];
  if (sourceFooter && outputFooter && maskVisibleText(strFromU8(sourceFooter)) !== maskVisibleText(strFromU8(outputFooter))) {
    throw new Error("report-template-protected-footer-structure-changed");
  }
}

const templateHeadingByReportHeading: Record<ReportSectionHeading, string> = {
  "Executive Summary": "Executive Summary",
  "Project Information": "Project Information",
  Introduction: "Introduction",
  "Acoustic Performance Specification": "Acoustic Performance Specification",
  "Inward Noise and Building Envelope Assessment": "Inward Noise & Building Envelope Assessment",
  "Internal Sound Insulation": "Internal Sound Insulation",
  "Room Acoustics": "Room Acoustics",
  "Building Services Noise": "Building Services Noise",
  "Construction Inspection and Commissioning": "Construction, Inspection & Commissioning",
};

function isNarrativeSlot(node: string) {
  if (!node.startsWith("<w:p") || !textOf(node)) return false;
  if (/^Heading[1-4]$/.test(paragraphStyle(node))) return false;
  if (textOf(node) === "ACOUSTIC DESIGN REPORT") return false;
  return !/<w:drawing\b|<w:pict\b/.test(node);
}

function fillNarrativeRange(nodes: string[], start: number, end: number, paragraphs: string[]) {
  const narrative = nodes
    .map((node, index) => ({ node, index }))
    .slice(start + 1, end)
    .filter(({ node }) => isNarrativeSlot(node));
  if (paragraphs.length > narrative.length) throw new Error("report-content-exceeds-fixed-template-slots");
  for (const [slotIndex, slot] of narrative.entries()) {
    nodes[slot.index] = replaceVisibleText(slot.node, paragraphs[slotIndex] ?? "");
  }
  for (let index = start + 1; index < end; index += 1) {
    const node = nodes[index];
    if (node.startsWith("<w:tbl")) nodes[index] = replaceVisibleText(node, "");
    if ((/<w:drawing\b|<w:pict\b/.test(node)) && textOf(node)) nodes[index] = replaceVisibleText(node, "");
  }
}

function replaceFirstParagraph(nodes: string[], sourceText: string, replacement: string) {
  const index = nodes.findIndex((node) => node.startsWith("<w:p") && textOf(node) === sourceText);
  if (index < 0) throw new Error(`report-template-slot-missing:${sourceText}`);
  nodes[index] = replaceVisibleText(nodes[index], replacement);
}

function citationDisplayTitle(plan: GroundedReportPlan, index: number) {
  const citation = plan.citations[index];
  return citation.citationNamespace === "B" ? "Approved book source" : citation.title;
}

export function buildGroundedReportDocx(templateBytes: Uint8Array, plan: GroundedReportPlan) {
  const sourceArchive = unzipSync(templateBytes);
  const outputArchive = { ...sourceArchive };
  const documentBytes = sourceArchive["word/document.xml"];
  const styles = sourceArchive["word/styles.xml"];
  if (!documentBytes || !styles) throw new Error("report-template-core-parts-missing");
  if (!strFromU8(styles).includes("Gibson")) throw new Error("report-template-gibson-style-missing");

  const sourceXml = strFromU8(documentBytes);
  const { open, nodes: sourceNodes, close } = bodyParts(sourceXml);
  const nodes = [...sourceNodes];

  // The generated file begins as an exact clone of the approved master. Only text in approved slots changes.
  replaceFirstParagraph(nodes, "Letterkenny SURS", plan.metadata.projectName);
  replaceFirstParagraph(nodes, "Phase 1 — Alpha Innovation Centre", plan.metadata.projectSubtitle ?? "");
  replaceFirstParagraph(
    nodes,
    "Letterkenny, Co Donegal · Prepared for VHA",
    [plan.metadata.address, plan.metadata.client ? `Prepared for ${plan.metadata.client}` : ""].filter(Boolean).join(" · "),
  );
  replaceFirstParagraph(nodes, "I S S U E D 0 3 S E P T E M B E R 2 0 2 6", `ISSUED ${plan.metadata.issueDate.toUpperCase()}`);
  replaceFirstParagraph(nodes, "VHA", plan.metadata.client ?? "");
  replaceFirstParagraph(nodes, "J2769", plan.metadata.projectNumber ?? "");
  replaceFirstParagraph(
    nodes,
    "A — 03/09/2026",
    [plan.metadata.revision, plan.metadata.issueDate].filter(Boolean).join(" — "),
  );
  replaceFirstParagraph(nodes, "LKPH1-IAC-XX-XX-RP-Y-0001", plan.metadata.documentNumber ?? plan.reportId);

  const titleSlots = nodes
    .map((node, index) => ({ index, text: textOf(node) }))
    .filter(({ text }) => text === "ACOUSTIC DESIGN REPORT");
  for (const slot of titleSlots) nodes[slot.index] = replaceVisibleText(nodes[slot.index], plan.metadata.reportTitle.toUpperCase());

  const projectInfoRuns = new Map<string, string>([
    ["Letterkenny", plan.metadata.projectName],
    ["SURS", ""],
    ["Phase", ""],
    ["1", ""],
    ["J2769", plan.metadata.projectNumber ?? ""],
    ["VHA", plan.metadata.client ?? ""],
    ["Letterkenny,", plan.metadata.address ?? ""],
    ["Co", ""],
    ["Donegal", ""],
    ["Acoustic", plan.metadata.reportTitle],
    ["Report", ""],
    ["LKPH1-IAC-XX-XX-RP-Y-", plan.metadata.documentNumber ?? plan.reportId],
    ["0001", ""],
  ]);
  for (const slot of [
    { source: "Project DescriptionLetterkenny SURS Phase 1", replacement: `Project Description${plan.metadata.projectName}` },
    { source: "Project NumberJ2769", replacement: `Project Number${plan.metadata.projectNumber ?? ""}` },
    { source: "ClientVHA", replacement: `Client${plan.metadata.client ?? ""}` },
    { source: "Site / AddressLetterkenny, Co Donegal", replacement: `Site / Address${plan.metadata.address ?? ""}` },
    { source: "Report TitleAcoustic Report", replacement: `Report Title${plan.metadata.reportTitle}` },
    { source: "Document NumberLKPH1-IAC-XX-XX-RP-Y-0001", replacement: `Document Number${plan.metadata.documentNumber ?? plan.reportId}` },
  ]) {
    const index = nodes.findIndex((node) => textOf(node) === slot.source);
    if (index < 0) throw new Error(`report-template-slot-missing:${slot.source}`);
    const patched = replaceExactRuns(nodes[index], projectInfoRuns);
    nodes[index] = textOf(patched) === slot.source ? replaceVisibleText(nodes[index], slot.replacement) : patched;
  }
  const projectControlRuns = new Map<string, string>([
    ["A", plan.metadata.revision ?? "-"],
    ["03/09/2026", plan.metadata.issueDate],
    ["Glen", "iAcoustics"],
    ["Plunkett,", ""],
    ["MSc,", ""],
    ["MIOA", ""],
    ["First", "Generated"],
    ["issue", "report"],
    ["for", ""],
    ["comment", ""],
  ]);
  for (let index = 0; index < nodes.length; index += 1) {
    const text = textOf(nodes[index]);
    if (nodes[index].startsWith("<w:tbl") && (text.startsWith("REVISIONDATEPREPARED") || text.startsWith("Glen Plunkett"))) {
      nodes[index] = replaceExactRuns(nodes[index], projectControlRuns);
    }
  }

  const headingPositions = new Map<ReportSectionHeading, number>();
  for (const heading of plan.sections.map((section) => section.heading)) {
    const sourceHeading = templateHeadingByReportHeading[heading];
    const position = nodes.findIndex(
      (node) => paragraphStyle(node) === "Heading1" && textOf(node) === sourceHeading,
    );
    if (position < 0) throw new Error(`report-template-heading-missing:${sourceHeading}`);
    headingPositions.set(heading, position);
  }

  const orderedSections = plan.sections
    .filter((section) => section.heading !== "Project Information")
    .map((section) => ({ section, start: headingPositions.get(section.heading)! }))
    .sort((left, right) => left.start - right.start);
  const allHeadingPositions = [...headingPositions.values()].sort((left, right) => left - right);
  const appendicesStart = nodes.findIndex((node) => textOf(node) === "A–D Appendices");
  for (const entry of orderedSections) {
    const next =
      allHeadingPositions.find((position) => position > entry.start) ??
      (appendicesStart > entry.start ? appendicesStart : nodes.length - 1);
    const content = entry.section.paragraphs.length
      ? entry.section.paragraphs
      : ["No grounded project evidence was available for this section at generation time."];
    fillNarrativeRange(nodes, entry.start, next, content);
  }

  const evidenceHeading = nodes.findIndex((node) => textOf(node) === "Design Standards & Guidance");
  const schedulesHeading = nodes.findIndex((node) => textOf(node) === "Acoustic Performance Schedules");
  if (evidenceHeading >= 0 && schedulesHeading > evidenceHeading) {
    const evidence = plan.citations.map((citation, index) => {
      const marker = `[${citation.marker ?? citation.citationNamespace ?? "D"}]`;
      const page = citation.pageNumber ? `, page ${citation.pageNumber}` : "";
      return `${marker} ${citationDisplayTitle(plan, index)}${page}: ${citation.excerpt}`;
    });
    fillNarrativeRange(nodes, evidenceHeading, schedulesHeading, evidence.length ? evidence : ["No evidence register entries."]);
  }
  const drawingsHeading = nodes.findIndex((node) => textOf(node) === "Acoustic Scope Drawings");
  const glossaryHeading = nodes.findIndex((node) => textOf(node) === "Glossary of Acoustic Terminology");
  if (drawingsHeading >= 0 && glossaryHeading > drawingsHeading) {
    const attachments = plan.supplementaryAttachments.map(
      (attachment) =>
        `${attachment.originalFileName} — ${attachment.byteLength.toLocaleString("en-IE")} bytes — ${attachment.evidenceStatus}`,
    );
    fillNarrativeRange(
      nodes,
      drawingsHeading,
      glossaryHeading,
      attachments.length ? attachments : ["No supplementary project documents were attached."],
    );
  }

  const closingRuns = new Map<string, string>([
    ["LKPH1-IAC-XX-XX-RP-Y-0001", plan.metadata.documentNumber ?? plan.reportId],
    ["Glen", "iAcoustics"],
    ["Plunkett,", ""],
    ["MSc,", ""],
    ["MIOA", ""],
  ]);
  for (let index = appendicesStart; index >= 0 && index < nodes.length; index += 1) {
    nodes[index] = replaceExactRuns(nodes[index], closingRuns);
  }

  outputArchive["word/document.xml"] = strToU8(`${open}${nodes.join("")}${close}`);
  const footer = outputArchive["word/footer1.xml"];
  if (footer) {
    outputArchive["word/footer1.xml"] = strToU8(
      replaceExactRuns(
        strFromU8(footer),
        new Map<string, string>([
          ["LKPH1-IAC-XX-XX-RP-Y-0001", plan.metadata.documentNumber ?? plan.reportId],
          ["A", plan.metadata.revision ?? "-"],
          ["03/09/2026", plan.metadata.issueDate],
        ]),
      ),
    );
  }

  const visibleOutput = textOf(nodes.join(""));
  for (const forbidden of ["Letterkenny", "VHA Architects", "J2769", "LKPH1"]) {
    if (visibleOutput.includes(forbidden)) throw new Error(`report-template-sample-content-leak:${forbidden}`);
  }

  assertProtectedShell(sourceArchive, outputArchive);
  return zipSync(outputArchive, { level: 6 });
}
