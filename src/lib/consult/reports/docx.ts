import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type {
  GroundedReportPlan,
  GroundedReportTable,
  ReportSectionHeading,
} from "@/lib/consult/reports/types";

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

/** Replace visible text only. Paragraph, run and drawing formatting remains unchanged. */
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

function compactRunFormatting(node: string, halfPoints: number, widthPercent: number) {
  let output = node.replace(/<w:sz\b[^>]*w:val="\d+"\s*\/>/g, `<w:sz w:val="${halfPoints}"/>`);
  output = output.replace(/<w:szCs\b[^>]*w:val="\d+"\s*\/>/g, `<w:szCs w:val="${halfPoints}"/>`);
  if (/<w:w\b/.test(output)) {
    output = output.replace(/<w:w\b[^>]*w:val="\d+"\s*\/>/g, `<w:w w:val="${widthPercent}"/>`);
  } else {
    output = output.replace(/<w:rPr>/g, `<w:rPr><w:w w:val="${widthPercent}"/>`);
    output = output.replace(/<w:rPr\s*\/>/g, `<w:rPr><w:w w:val="${widthPercent}"/></w:rPr>`);
  }
  return output;
}

function stripBookmarks(node: string) {
  return node
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, "")
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, "");
}

function stripSectionProperties(node: string) {
  return node.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, "");
}

function pageBreakParagraph() {
  return '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
}

function bodyParagraph(template: string, value: string) {
  return replaceVisibleText(stripBookmarks(template), value);
}

function captionParagraph(value: string) {
  return `<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="180" w:after="80"/><w:keepNext/><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/><w:b/><w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/><w:b/><w:color w:val="1A4F88"/><w:sz w:val="18"/></w:rPr><w:t>${escapeXml(value)}</w:t></w:r></w:p>`;
}

function tableCell(value: string, options: { header: boolean; shaded: boolean; width: number }) {
  const fill = options.header ? "1A4F88" : options.shaded ? "F2F5F8" : "FFFFFF";
  const color = options.header ? "FFFFFF" : "1D1D1B";
  const bold = options.header ? "<w:b/>" : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="TableParagraph"/><w:spacing w:after="0"/><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/>${bold}<w:sz w:val="18"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/>${bold}<w:color w:val="${color}"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
}

function reportTable(table: GroundedReportTable) {
  const width = 9208;
  const cellWidth = Math.floor(width / table.columns.length);
  const grid = table.columns.map(() => `<w:gridCol w:w="${cellWidth}"/>`).join("");
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`)
    .join("");
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${table.columns
    .map((value) => tableCell(value, { header: true, shaded: false, width: cellWidth }))
    .join("")}</w:tr>`;
  const rows = table.rows
    .map(
      (row, index) =>
        `<w:tr>${row
          .map((value) => tableCell(value, { header: false, shaded: index % 2 === 1, width: cellWidth }))
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="left"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${rows}</w:tbl>`;
}

function tocFieldParagraph() {
  return '<w:p><w:pPr><w:pStyle w:val="BodyText"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-4" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/><w:color w:val="577591"/><w:sz w:val="20"/></w:rPr><w:t>The table of contents updates automatically when this report opens in Microsoft Word.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
}

function enableFieldUpdates(settingsXml: string) {
  if (/<w:updateFields\b/.test(settingsXml)) {
    return settingsXml.replace(/<w:updateFields\b[^>]*\/>/, '<w:updateFields w:val="true"/>');
  }
  if (/<w:settings\b[^>]*\/>\s*$/.test(settingsXml)) {
    return settingsXml.replace(
      /<w:settings\b([^>]*)\/>\s*$/,
      '<w:settings$1><w:updateFields w:val="true"/></w:settings>',
    );
  }
  return settingsXml.replace(/<\/w:settings>\s*$/, '<w:updateFields w:val="true"/></w:settings>');
}

function remapDrawingIds(xml: string, startAt: number) {
  let nextId = startAt;
  return xml.replace(
    /(<(?:wp:docPr|pic:cNvPr|wps:cNvPr)\b[^>]*\bid=")[0-9]+(")/g,
    (_match, prefix: string, suffix: string) => `${prefix}${nextId++}${suffix}`,
  );
}

function compactDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${parsed.getFullYear()}`;
}

function maskVisibleText(xml: string) {
  return xml.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, "$1__DYNAMIC_TEXT__$2");
}

function assertProtectedShell(sourceArchive: Record<string, Uint8Array>, outputArchive: Record<string, Uint8Array>) {
  const mutableParts = new Set(["word/document.xml", "word/footer1.xml", "word/settings.xml"]);
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

  const sourceDocument = strFromU8(sourceArchive["word/document.xml"]);
  const outputDocument = strFromU8(outputArchive["word/document.xml"]);
  const sourcePageGeometry = new Set(sourceDocument.match(/<w:(?:pgSz|pgMar)\b[^>]*\/>/g) ?? []);
  for (const geometry of outputDocument.match(/<w:(?:pgSz|pgMar)\b[^>]*\/>/g) ?? []) {
    if (!sourcePageGeometry.has(geometry)) throw new Error("report-template-page-geometry-changed");
  }
  if (!(outputDocument.match(/<w:sectPr\b/g) ?? []).length) {
    throw new Error("report-template-section-geometry-missing");
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

function replaceFirstParagraph(nodes: string[], sourceText: string, replacement: string) {
  const index = nodes.findIndex((node) => node.startsWith("<w:p") && textOf(node) === sourceText);
  if (index < 0) throw new Error(`report-template-slot-missing:${sourceText}`);
  nodes[index] = replaceVisibleText(nodes[index], replacement);
  return index;
}

function citationDisplayTitle(plan: GroundedReportPlan, index: number) {
  const citation = plan.citations[index];
  return citation.citationNamespace === "B" ? "Approved book source" : citation.title;
}

function appendSectionContent(target: string[], bodyTemplate: string, paragraphs: string[], tables: GroundedReportTable[]) {
  for (const paragraph of paragraphs) target.push(bodyParagraph(bodyTemplate, paragraph));
  for (const table of tables) {
    target.push(captionParagraph(table.title));
    target.push(reportTable(table));
  }
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
  const shortDate = compactDate(plan.metadata.issueDate);

  replaceFirstParagraph(nodes, "Letterkenny SURS", plan.metadata.projectName);
  replaceFirstParagraph(nodes, "Phase 1 — Alpha Innovation Centre", plan.metadata.projectSubtitle ?? "");
  replaceFirstParagraph(
    nodes,
    "Letterkenny, Co Donegal · Prepared for VHA",
    [plan.metadata.address, plan.metadata.client ? `Prepared for ${plan.metadata.client}` : ""].filter(Boolean).join(" · "),
  );
  replaceFirstParagraph(nodes, "I S S U E D 0 3 S E P T E M B E R 2 0 2 6", `ISSUED ${plan.metadata.issueDate.toUpperCase()}`);
  const clientCover = replaceFirstParagraph(nodes, "VHA", plan.metadata.client ?? "");
  nodes[clientCover] = compactRunFormatting(nodes[clientCover], 17, 75);
  replaceFirstParagraph(nodes, "J2769", plan.metadata.projectNumber ?? "");
  replaceFirstParagraph(nodes, "A — 03/09/2026", [plan.metadata.revision, shortDate].filter(Boolean).join(" — "));
  const documentCover = replaceFirstParagraph(nodes, "LKPH1-IAC-XX-XX-RP-Y-0001", plan.metadata.documentNumber ?? plan.reportId);
  nodes[documentCover] = compactRunFormatting(nodes[documentCover], 17, 78);

  const coverImageLabel = nodes.findIndex((node) => textOf(node).includes("drop cover image"));
  if (coverImageLabel >= 0) nodes[coverImageLabel] = replaceVisibleText(nodes[coverImageLabel], "");

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
    ["03/09/2026", shortDate],
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
    const position = nodes.findIndex((node) => paragraphStyle(node) === "Heading1" && textOf(node) === sourceHeading);
    if (position < 0) throw new Error(`report-template-heading-missing:${sourceHeading}`);
    headingPositions.set(heading, position);
  }
  const executiveStart = headingPositions.get("Executive Summary")!;
  const projectStart = headingPositions.get("Project Information")!;
  const tocStart = nodes.findIndex((node) => textOf(node) === "Table of Contents");
  const appendicesStart = nodes.findIndex((node) => textOf(node) === "A–D Appendices");
  const finalSection = nodes.findLastIndex((node) => node.startsWith("<w:sectPr"));
  if (tocStart < 0 || appendicesStart < 0 || finalSection < 0) throw new Error("report-template-layout-anchor-missing");

  const introductionPosition = headingPositions.get("Introduction")!;
  const bodyTemplate = nodes.find(
    (node, index) => index > introductionPosition && paragraphStyle(node) === "BodyText" && textOf(node),
  );
  if (!bodyTemplate) throw new Error("report-template-body-style-slot-missing");
  const singleColumnSectionBreak = nodes.findLast(
    (node, index) =>
      index < introductionPosition
      && node.startsWith("<w:p")
      && /<w:sectPr\b/.test(node)
      && !/<w:cols\b[^>]*w:num=/.test(node),
  );
  if (!singleColumnSectionBreak) throw new Error("report-template-single-column-section-break-missing");
  const genericChrome = nodes
    .slice(Math.max(0, introductionPosition - 4), introductionPosition)
    .filter(
      (node) =>
        /<w:drawing\b|<w:pict\b/.test(node)
        && textOf(node) !== "ACOUSTIC DESIGN REPORT",
    )
    .map((node) => stripSectionProperties(stripBookmarks(node)));

  const rebuilt: string[] = [];
  rebuilt.push(...nodes.slice(0, executiveStart));

  const executive = plan.sections.find((section) => section.heading === "Executive Summary")!;
  rebuilt.push(nodes[executiveStart]);
  appendSectionContent(rebuilt, bodyTemplate, executive.paragraphs, executive.tables);

  rebuilt.push(pageBreakParagraph());
  const projectBlock = nodes.slice(projectStart, tocStart);
  const splitParagraph = projectBlock.findIndex((node) => textOf(node).endsWith("the conclusions in"));
  if (
    splitParagraph >= 0
    && projectBlock[splitParagraph + 1]
    && /<w:sectPr\b/.test(projectBlock[splitParagraph + 1])
    && projectBlock[splitParagraph + 2]
    && textOf(projectBlock[splitParagraph + 2]).startsWith("this report may no longer remain valid")
  ) {
    projectBlock[splitParagraph] = replaceVisibleText(
      projectBlock[splitParagraph],
      `${textOf(projectBlock[splitParagraph])} ${textOf(projectBlock[splitParagraph + 2])}`,
    );
    projectBlock.splice(splitParagraph + 1, 2);
  }
  rebuilt.push(...projectBlock);

  rebuilt.push(nodes[tocStart]);
  rebuilt.push(tocFieldParagraph());
  rebuilt.push(stripBookmarks(singleColumnSectionBreak));

  let generatedSectionIndex = 0;
  for (const section of plan.sections) {
    if (section.heading === "Executive Summary" || section.heading === "Project Information") continue;
    if (section.paragraphs.length === 0 && section.tables.length === 0) continue;
    const position = headingPositions.get(section.heading)!;
    rebuilt.push(pageBreakParagraph());
    if (!/<w:drawing\b|<w:pict\b/.test(nodes[position])) {
      rebuilt.push(
        ...genericChrome.map((node, chromeIndex) =>
          remapDrawingIds(node, 10_000 + generatedSectionIndex * 100 + chromeIndex * 10),
        ),
      );
    }
    rebuilt.push(nodes[position]);
    appendSectionContent(rebuilt, bodyTemplate, section.paragraphs, section.tables);
    generatedSectionIndex += 1;
  }

  rebuilt.push(stripBookmarks(singleColumnSectionBreak));
  rebuilt.push(pageBreakParagraph());
  rebuilt.push(nodes[appendicesStart]);
  const appendixHeading = (source: string) => {
    const node = nodes.find((candidate) => paragraphStyle(candidate) === "Heading4" && textOf(candidate) === source);
    if (!node) throw new Error(`report-template-appendix-heading-missing:${source}`);
    return node;
  };
  rebuilt.push(appendixHeading("Design Standards & Guidance"));
  for (const [index, citation] of plan.citations.entries()) {
    const marker = `[${citation.marker ?? citation.citationNamespace ?? "D"}]`;
    const page = citation.pageNumber ? `, page ${citation.pageNumber}` : "";
    rebuilt.push(bodyParagraph(bodyTemplate, `${marker} ${citationDisplayTitle(plan, index)}${page}: ${citation.excerpt}`));
  }
  if (plan.sections.some((section) => section.tables.length)) {
    rebuilt.push(appendixHeading("Acoustic Performance Schedules"));
    rebuilt.push(
      bodyParagraph(
        bodyTemplate,
        "Performance schedules are presented in the relevant report sections and are derived only from cited project evidence.",
      ),
    );
  }
  if (plan.supplementaryAttachments.length) {
    rebuilt.push(appendixHeading("Acoustic Scope Drawings"));
    for (const attachment of plan.supplementaryAttachments) {
      rebuilt.push(
        bodyParagraph(
          bodyTemplate,
          `${attachment.originalFileName} — ${attachment.byteLength.toLocaleString("en-IE")} bytes — ${attachment.evidenceStatus}`,
        ),
      );
    }
  }
  rebuilt.push(appendixHeading("Glossary of Acoustic Terminology"));
  rebuilt.push(bodyParagraph(bodyTemplate, "Technical acoustic notation is used throughout in accordance with the cited project evidence and standards."));
  rebuilt.push(nodes[finalSection]);

  outputArchive["word/document.xml"] = strToU8(`${open}${rebuilt.join("")}${close}`);
  const footer = outputArchive["word/footer1.xml"];
  if (footer) {
    outputArchive["word/footer1.xml"] = strToU8(
      replaceExactRuns(
        strFromU8(footer),
        new Map<string, string>([
          ["LKPH1-IAC-XX-XX-RP-Y-0001", plan.metadata.documentNumber ?? plan.reportId],
          ["A", plan.metadata.revision ?? "-"],
          ["03/09/2026", shortDate],
        ]),
      ),
    );
  }
  const settings = outputArchive["word/settings.xml"];
  if (settings) outputArchive["word/settings.xml"] = strToU8(enableFieldUpdates(strFromU8(settings)));

  const visibleOutput = textOf(rebuilt.join(""));
  for (const forbidden of ["Letterkenny", "VHA Architects", "J2769", "LKPH1"]) {
    if (visibleOutput.includes(forbidden)) throw new Error(`report-template-sample-content-leak:${forbidden}`);
  }

  assertProtectedShell(sourceArchive, outputArchive);
  return zipSync(outputArchive, { level: 6 });
}
