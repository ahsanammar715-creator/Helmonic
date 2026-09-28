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

function markTextRunsAsPresentation(node: string) {
  return node.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (whole, attributes: string, body: string) => {
    if (!/<w:t\b/.test(body)) return whole;
    let updatedBody = body
      .replace(/<w:noProof\b[^>]*\/>/g, "")
      .replace(/<w:u\b[^>]*(?:\/>|>[\s\S]*?<\/w:u>)/g, "");
    const properties = '<w:noProof/><w:u w:val="none"/>';
    if (/<w:rPr\b[^>]*\/>/.test(updatedBody)) {
      updatedBody = updatedBody.replace(/<w:rPr\b([^>]*)\/>/, `<w:rPr$1>${properties}</w:rPr>`);
    } else if (/<w:rPr\b[^>]*>/.test(updatedBody)) {
      updatedBody = updatedBody.replace(/<w:rPr\b([^>]*)>/, `<w:rPr$1>${properties}`);
    } else {
      updatedBody = `<w:rPr>${properties}</w:rPr>${updatedBody}`;
    }
    return `<w:r${attributes}>${updatedBody}</w:r>`;
  });
}

function setParagraphJustification(node: string, value: "left" | "center" | "right") {
  if (/<w:jc\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:jc\b[^>]*\/>/, `<w:jc w:val="${value}"/>`);
  }
  if (/<w:pPr\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)\/>/, `<w:pPr$1><w:jc w:val="${value}"/></w:pPr>`);
  }
  if (/<w:pPr\b[^>]*>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1><w:jc w:val="${value}"/>`);
  }
  return node.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr><w:jc w:val="${value}"/></w:pPr>`);
}

function setParagraphSpacingBefore(node: string, value: number) {
  if (/<w:spacing\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:spacing\b([^>]*)\/>/, (_whole, attributes: string) => {
      const retained = attributes.replace(/\s+w:before="[^"]*"/g, "");
      return `<w:spacing${retained} w:before="${value}"/>`;
    });
  }
  if (/<w:pPr\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)\/>/, `<w:pPr$1><w:spacing w:before="${value}"/></w:pPr>`);
  }
  if (/<w:pPr\b[^>]*>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1><w:spacing w:before="${value}"/>`);
  }
  return node.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr><w:spacing w:before="${value}"/></w:pPr>`);
}

function setParagraphSpacing(
  node: string,
  values: { before?: number; after?: number; line?: number; lineRule?: "auto" | "exact" | "atLeast" },
) {
  const attributes = [
    values.before === undefined ? "" : ` w:before="${values.before}"`,
    values.after === undefined ? "" : ` w:after="${values.after}"`,
    values.line === undefined ? "" : ` w:line="${values.line}"`,
    values.lineRule === undefined ? "" : ` w:lineRule="${values.lineRule}"`,
  ].join("");
  if (/<w:spacing\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:spacing\b([^>]*)\/>/, (_whole, existing: string) => {
      const retained = existing.replace(/\s+w:(?:before|after|line|lineRule)="[^"]*"/g, "");
      return `<w:spacing${retained}${attributes}/>`;
    });
  }
  if (/<w:pPr\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)\/>/, `<w:pPr$1><w:spacing${attributes}/></w:pPr>`);
  }
  if (/<w:pPr\b[^>]*>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1><w:spacing${attributes}/>`);
  }
  return node.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr><w:spacing${attributes}/></w:pPr>`);
}

function normalizeRunTracking(node: string) {
  return node.replace(/<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>/g, (_whole, attributes: string, body: string) =>
    `<w:rPr${attributes}>${body.replace(/<w:(?:spacing|w)\b[^>]*\/>/g, "")}</w:rPr>`,
  );
}

function normalizeRunTypography(node: string, halfPoints: number, regular = false) {
  return node.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (whole, attributes: string, body: string) => {
    if (!/<w:t\b/.test(body)) return whole;
    let stripped = body
      .replace(/<w:rFonts\b[^>]*\/>/g, "")
      .replace(/<w:(?:sz|szCs|spacing|w|i|iCs)\b[^>]*\/>/g, "");
    if (regular) stripped = stripped.replace(/<w:(?:b|bCs)\b[^>]*\/>/g, "");
    const typography = `<w:rFonts w:ascii="Gibson" w:hAnsi="Gibson" w:eastAsia="Gibson" w:cs="Gibson"/><w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
    let updatedBody = stripped;
    if (/<w:rPr\b[^>]*\/>/.test(updatedBody)) {
      updatedBody = updatedBody.replace(/<w:rPr\b([^>]*)\/>/, `<w:rPr$1>${typography}</w:rPr>`);
    } else if (/<w:rPr\b[^>]*>/.test(updatedBody)) {
      updatedBody = updatedBody.replace(/<w:rPr\b([^>]*)>/, `<w:rPr$1>${typography}`);
    } else {
      updatedBody = `<w:rPr>${typography}</w:rPr>${updatedBody}`;
    }
    return `<w:r${attributes}>${updatedBody}</w:r>`;
  });
}

function normalizeApprovalLabel(node: string) {
  const compact = textOf(node).replace(/\s+/g, "");
  const labels = new Map([
    ["WRITTENBY", "WRITTEN BY"],
    ["REVIEWEDBY", "REVIEWED BY"],
    ["APPROVEDFORISSUE", "APPROVED FOR ISSUE"],
  ]);
  const label = labels.get(compact);
  if (!label) return node;
  return markTextRunsAsPresentation(normalizeRunTracking(replaceVisibleText(node, label)));
}

function normalizeCoverLabel(node: string) {
  const compact = textOf(node).replace(/\s+/g, "");
  const labels = new Map([
    ["CLIENT", "CLIENT"],
    ["PROJECTNO.", "PROJECT NO."],
    ["REVISION", "REVISION"],
    ["DOCUMENT", "DOCUMENT"],
  ]);
  const label = labels.get(compact);
  if (!label) return node;
  return markTextRunsAsPresentation(normalizeRunTracking(replaceVisibleText(node, label)));
}

function polishTocTable(node: string) {
  return node.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (row) => {
    const anchors = [...row.matchAll(/<w:hyperlink\b[^>]*w:anchor="([^"]+)"/g)].map((match) => match[1]);
    const rowText = textOf(row);
    const topLevel = anchors.some((anchor) => /^(?:exec|s[1-7])$/.test(anchor))
      || /^(?:Executive Summary|[1-7]\s|Appendix\s+[A-D]\b)/.test(rowText);
    return row.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
      const spaced = topLevel ? setParagraphSpacingBefore(paragraph, 251) : paragraph;
      return markTextRunsAsPresentation(normalizeRunTypography(normalizeRunTracking(spaced), topLevel ? 22 : 20, true));
    });
  });
}

function normalizeCaption(node: string) {
  const value = textOf(node);
  if (!/^(?:Figure|Table)\s+\d+(?:-\d+)?\s+/i.test(value)) return node;
  return markTextRunsAsPresentation(
    normalizeRunTracking(
      setParagraphSpacing(replaceVisibleText(node, value.replace(/\s+/g, " ").trim()), { before: 60, after: 90 }),
    ),
  );
}

function normalizeCompactSubheading(node: string) {
  if (paragraphStyle(node) !== "ListParagraph") return node;
  const value = textOf(node);
  if (!/^(?:General Construction Method|Internal Partition Junction Typical Detail|Partition to Mullion Typical Detail|Deflection Head Typical Detail)$/i.test(value)) {
    return node;
  }
  return markTextRunsAsPresentation(
    keepParagraphTogether(
      normalizeRunTypography(normalizeRunTracking(setParagraphSpacingBefore(node, 82)), 18),
    ),
  );
}

function normalizeSectionSubheading(node: string) {
  if (paragraphStyle(node) !== "Heading4") return node;
  return markTextRunsAsPresentation(
    keepParagraphTogether(
      normalizeRunTypography(normalizeRunTracking(setParagraphSpacing(node, { before: 120, after: 80 })), 22),
    ),
  );
}

function normalizeDisclaimerLayout(nodes: string[]) {
  const start = nodes.findIndex((node) => textOf(node).startsWith("This report has been prepared by Integrated Acoustic Solutions Ltd"));
  const end = nodes.findIndex((node, index) => index > start && textOf(node).toLowerCase().startsWith("this report may no longer remain valid"));
  if (start < 0 || end < start) return;
  for (let index = start; index <= end; index += 1) {
    if (!nodes[index].startsWith("<w:p") || !textOf(nodes[index])) continue;
    nodes[index] = setParagraphSpacing(nodes[index], {
      before: index === start ? 60 : 36,
      after: 0,
      line: 276,
      lineRule: "auto",
    });
  }
}

function normalizeInternalFlowBreaks(nodes: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (!/<w:sectPr\b/.test(nodes[index])) continue;
    const preceding = nodes.slice(0, index).findLast((node) => node.startsWith("<w:p") && Boolean(textOf(node)));
    if (!preceding || !/^Door sets/i.test(textOf(preceding))) continue;
    if (/<w:type\b[^>]*\/>/.test(nodes[index])) {
      nodes[index] = nodes[index].replace(/<w:type\b[^>]*\/>/, '<w:type w:val="continuous"/>');
    } else {
      nodes[index] = nodes[index].replace(/<w:sectPr\b([^>]*)>/, '<w:sectPr$1><w:type w:val="continuous"/>');
    }
  }
}

function normalizeComponentParagraph(node: string) {
  if (!/^(?:Glazed screens|Door sets|Folding partitions|Riser doors)/i.test(textOf(node))) return node;
  return setParagraphSpacing(node, { before: 36, after: 0, line: 276, lineRule: "auto" });
}

function normalizeHeadingIntroductions(nodes: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (paragraphStyle(nodes[index]) !== "Heading4") continue;
    for (let following = index + 1; following < nodes.length; following += 1) {
      if (!nodes[following].startsWith("<w:p")) break;
      const value = textOf(nodes[following]);
      if (!value) continue;
      if (value.length <= 900) {
        nodes[following] = setParagraphSpacing(nodes[following], {
          before: 40,
          after: 0,
          line: 286,
          lineRule: "auto",
        });
      }
      break;
    }
  }
}

function protectCompactSubheadingIntroductions(nodes: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (paragraphStyle(nodes[index]) !== "ListParagraph") continue;
    if (!/^(?:General Construction Method|Internal Partition Junction Typical Detail|Partition to Mullion Typical Detail|Deflection Head Typical Detail)$/i.test(textOf(nodes[index]))) continue;
    for (let following = index + 1; following < nodes.length; following += 1) {
      if (!nodes[following].startsWith("<w:p")) break;
      if (!textOf(nodes[following])) continue;
      nodes[following] = keepParagraphTogether(nodes[following], false);
      break;
    }
  }
}

function forceParagraphStart(node: string) {
  if (!textOf(node).startsWith("Refer to Appendix A — Design Standards & Guidance")) return node;
  return node.replace(/<w:r\b([^>]*)>/, '<w:r$1><w:br/>');
}

function polishEndIdentity(node: string) {
  if (!textOf(node).startsWith("Integrated Acoustic Solutions Ltd")) return node;
  return setParagraphSpacing(node, { before: 220, after: 0 });
}

function protectParagraphsBeforeSectionBreaks(nodes: string[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (!/<w:sectPr\b/.test(nodes[index])) continue;
    for (let preceding = index - 1; preceding >= 0; preceding -= 1) {
      if (!nodes[preceding].startsWith("<w:p")) continue;
      if (!textOf(nodes[preceding])) continue;
      nodes[preceding] = keepParagraphTogether(nodes[preceding], false);
      break;
    }
  }
}

function alignDisclaimerContinuation(nodes: string[]) {
  const tail = nodes.findIndex((node) => textOf(node).toLowerCase().startsWith("this report may no longer remain valid"));
  if (tail < 0) return;
  const section = nodes.findIndex((node, index) => index > tail && /<w:sectPr\b/.test(node));
  if (section < 0) return;
  if (/<w:type\b[^>]*\/>/.test(nodes[section])) {
    nodes[section] = nodes[section].replace(/<w:type\b[^>]*\/>/, '<w:type w:val="continuous"/>');
  } else {
    nodes[section] = nodes[section].replace(/<w:sectPr\b([^>]*)>/, '<w:sectPr$1><w:type w:val="continuous"/>');
  }
  nodes[tail] = markTextRunsAsPresentation(nodes[tail]);
}

function polishFooterIdentity(footerXml: string) {
  return footerXml.replace(
    /(<w:txbxContent>)(<w:p\b[\s\S]*?<\/w:p>)(<\/w:txbxContent>)/g,
    (whole, open: string, paragraph: string, close: string) => {
      const text = textOf(paragraph);
      if (!text.includes("Revision") || !text.includes("·")) return whole;
      return `${open}${markTextRunsAsPresentation(setParagraphJustification(paragraph, "center"))}${close}`;
    },
  );
}

function polishEndOfReport(node: string, documentNumber: string, revision: string) {
  if (!textOf(node).replace(/\s+/g, "").startsWith("Endofreport")) return node;
  let output = node.replace(/<w:ind\b([^>]*)\/>/, (_whole, attributes: string) => {
    const retained = attributes.replace(/\s+w:firstLine="[^"]*"/g, "");
    return `<w:ind${retained} w:firstLine="0"/>`;
  });
  output = setParagraphJustification(output, "right");
  output = replaceExactRuns(output, new Map([["A", revision]]));
  const escapedDocumentNumber = escapeXml(documentNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const documentRun = new RegExp(`(<w:r\\b[^>]*>(?:(?!<\\/w:r>)[\\s\\S])*?)(<w:t\\b[^>]*>${escapedDocumentNumber}<\\/w:t>)`);
  if (documentRun.test(output)) output = output.replace(documentRun, "$1<w:br/>$2");
  return markTextRunsAsPresentation(output);
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
  const output = node.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_whole, attributes: string) => {
    const value = used ? "" : escapeXml(replacement);
    used = true;
    return `<w:t${attributes}>${value}</w:t>`;
  });
  return markTextRunsAsPresentation(output);
}

function replaceExactRuns(node: string, replacements: Map<string, string>, markPresentation = true) {
  let changed = false;
  const output = node.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (whole, attributes: string, value: string) => {
    const replacement = replacements.get(decodeXml(value));
    if (replacement === undefined) return whole;
    changed = true;
    return `<w:t${attributes}>${escapeXml(replacement)}</w:t>`;
  });
  return changed && markPresentation ? markTextRunsAsPresentation(output) : output;
}

function replaceValueAfterPrefix(node: string, prefix: string, replacement: string) {
  let visible = "";
  let inserted = false;
  return node.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (whole, attributes: string, value: string) => {
    const decoded = decodeXml(value);
    if (visible.length < prefix.length) {
      const priorLength = visible.length;
      visible += decoded;
      if (visible.length <= prefix.length) return whole;
      const retainedPrefix = decoded.slice(0, prefix.length - priorLength);
      inserted = true;
      return `<w:t${attributes}>${escapeXml(`${retainedPrefix}${replacement}`)}</w:t>`;
    }
    if (inserted) return `<w:t${attributes}></w:t>`;
    inserted = true;
    return `<w:t${attributes}>${escapeXml(replacement)}</w:t>`;
  });
}

function tableCellCount(node: string) {
  return (node.match(/<w:tc\b/g) ?? []).length;
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

function keepParagraphTogether(node: string, keepWithNext = true) {
  const controls = `${keepWithNext ? "<w:keepNext/>" : ""}<w:keepLines/>`;
  if (/<w:pPr\b[^>]*\/>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)\/>/, `<w:pPr$1>${controls}</w:pPr>`);
  }
  if (/<w:pPr\b[^>]*>/.test(node)) {
    return node.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1>${controls}`);
  }
  return node.replace(/<w:p\b([^>]*)>/, `<w:p$1><w:pPr>${controls}</w:pPr>`);
}

function stripBookmarks(node: string) {
  return node
    .replace(/<w:bookmarkStart\b[^>]*\/>/g, "")
    .replace(/<w:bookmarkEnd\b[^>]*\/>/g, "");
}

function stripSectionProperties(node: string) {
  return node.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, "");
}

function stripFloatingDrawings(node: string) {
  return node.replace(/<w:r\b[^>]*>[\s\S]*?<w:drawing\b[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/g, "");
}

function sectionBreak(node: string, start: "continuous" | "nextPage", columns = 1) {
  let output = stripBookmarks(node);
  const type = `<w:type w:val="${start}"/>`;
  if (/<w:type\b[^>]*\/>/.test(output)) {
    output = output.replace(/<w:type\b[^>]*\/>/, type);
  } else {
    output = output.replace(/<w:sectPr\b([^>]*)>/, `<w:sectPr$1>${type}`);
  }
  const columnDefinition = `<w:cols w:num="${columns}"/>`;
  if (/<w:cols\b[^>]*(?:\/>|>[\s\S]*?<\/w:cols>)/.test(output)) {
    output = output.replace(/<w:cols\b[^>]*(?:\/>|>[\s\S]*?<\/w:cols>)/, columnDefinition);
  } else {
    output = output.replace(/<\/w:sectPr>/, `${columnDefinition}</w:sectPr>`);
  }
  return output;
}

function tocFieldBlock(headings: string[]) {
  if (headings.length === 0) return [];
  return headings.map((heading, index) => {
    const begin = index === 0
      ? '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'
      : "";
    const end = index === headings.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : "";
    return `<w:p><w:pPr><w:pStyle w:val="TOC1"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9208"/></w:tabs><w:spacing w:after="80"/></w:pPr>${begin}<w:r><w:rPr><w:rFonts w:ascii="Gibson" w:hAnsi="Gibson"/><w:sz w:val="20"/></w:rPr><w:t>${escapeXml(heading)}</w:t></w:r>${end}</w:p>`;
  });
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
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row
          .map((value) => tableCell(value, { header: false, shaded: index % 2 === 1, width: cellWidth }))
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="left"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${rows}</w:tbl>`;
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

function compactDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${parsed.getFullYear()}`;
}

function issuedDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value.toUpperCase();
  const month = new Intl.DateTimeFormat("en-IE", { month: "long", timeZone: "UTC" }).format(parsed).toUpperCase();
  return `I S S U E D ${String(parsed.getUTCDate()).split("").join(" ")} ${month.split("").join(" ")} ${String(parsed.getUTCFullYear()).split("").join(" ")}`;
}

function replaceTableCells(node: string, values: string[]) {
  let index = 0;
  return node.replace(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g, (cell) =>
    replaceVisibleText(cell, values[index++] ?? ""),
  );
}

function maskVisibleText(xml: string) {
  return xml.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, "$1__DYNAMIC_TEXT__$2");
}

function maskPermittedFooterPresentation(xml: string) {
  return maskVisibleText(xml)
    .replace(/<w:noProof\s*\/>/g, "")
    .replace(/<w:u\b[^>]*w:val="none"[^>]*\/>/g, "")
    .replace(/<w:rPr>\s*<\/w:rPr>/g, "")
    .replace(/<w:rPr\s*\/>/g, "")
    .replace(/<w:jc w:val="center"\s*\/>/g, '<w:jc w:val="left"/>');
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
  if (sourceFooter && outputFooter) {
    const protectedSourceFooter = maskPermittedFooterPresentation(strFromU8(sourceFooter));
    const protectedOutputFooter = maskPermittedFooterPresentation(strFromU8(outputFooter));
    if (protectedSourceFooter !== protectedOutputFooter) {
      const mismatch = [...protectedSourceFooter].findIndex((value, index) => protectedOutputFooter[index] !== value);
      throw new Error(
        `report-template-protected-footer-structure-changed:${mismatch}:${protectedSourceFooter.slice(Math.max(0, mismatch - 80), mismatch + 160)}:${protectedOutputFooter.slice(Math.max(0, mismatch - 80), mismatch + 160)}`,
      );
    }
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
  const resolvedRevision = plan.metadata.revision?.trim() || "A";
  const resolvedDocumentNumber = plan.metadata.documentNumber ?? plan.metadata.projectNumber ?? "-";

  replaceFirstParagraph(nodes, "Letterkenny SURS", plan.metadata.projectName);
  replaceFirstParagraph(nodes, "Phase 1 — Alpha Innovation Centre", plan.metadata.projectSubtitle ?? "");
  replaceFirstParagraph(
    nodes,
    "Letterkenny, Co Donegal · Prepared for VHA",
    [plan.metadata.address, plan.metadata.client ? `Prepared for ${plan.metadata.client}` : ""].filter(Boolean).join(" · "),
  );
  replaceFirstParagraph(nodes, "I S S U E D 0 3 S E P T E M B E R 2 0 2 6", issuedDate(plan.metadata.issueDate));
  replaceFirstParagraph(nodes, "VHA", plan.metadata.client ?? "-");
  replaceFirstParagraph(nodes, "J2769", plan.metadata.projectNumber ?? "-");
  replaceFirstParagraph(nodes, "A — 03/09/2026", `${resolvedRevision} — ${shortDate}`);
  replaceFirstParagraph(
    nodes,
    "LKPH1-IAC-XX-XX-RP-Y-0001",
    resolvedDocumentNumber,
  );

  const titleSlots = nodes
    .map((node, index) => ({ index, text: textOf(node) }))
    .filter(({ text }) => text === "ACOUSTIC DESIGN REPORT");
  for (const slot of titleSlots) nodes[slot.index] = replaceVisibleText(nodes[slot.index], plan.metadata.reportTitle.toUpperCase());

  for (const slot of [
    { source: "Project DescriptionLetterkenny SURS Phase 1", prefix: "Project Description", replacement: plan.metadata.projectName },
    { source: "Project NumberJ2769", prefix: "Project Number", replacement: plan.metadata.projectNumber ?? "-" },
    { source: "ClientVHA", prefix: "Client", replacement: plan.metadata.client ?? "-" },
    { source: "Site / AddressLetterkenny, Co Donegal", prefix: "Site / Address", replacement: plan.metadata.address ?? "-" },
    { source: "Report TitleAcoustic Report", prefix: "Report Title", replacement: plan.metadata.reportTitle },
    { source: "Document NumberLKPH1-IAC-XX-XX-RP-Y-0001", prefix: "Document Number", replacement: resolvedDocumentNumber },
  ]) {
    const index = nodes.findIndex((node) => textOf(node) === slot.source);
    if (index < 0) throw new Error(`report-template-slot-missing:${slot.source}`);
    nodes[index] = replaceValueAfterPrefix(nodes[index], slot.prefix, slot.replacement);
  }

  const projectControlRuns = new Map<string, string>([
    ["A", resolvedRevision],
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
  const tocEnd = nodes.findLastIndex(
    (node, index) => index > tocStart && index < introductionPosition && /<w:sectPr\b/.test(node),
  );
  if (tocEnd < tocStart) throw new Error("report-template-toc-end-missing");
  const rebuilt = [...nodes];
  for (let index = tocStart + 1; index < tocEnd; index += 1) {
    if (rebuilt[index]?.startsWith("<w:tbl")) rebuilt[index] = polishTocTable(rebuilt[index]);
  }
  const executiveTable = nodes.findIndex(
    (node, index) => index > executiveStart && index < projectStart && node.startsWith("<w:tbl"),
  );
  const executive = plan.sections.find((section) => section.heading === "Executive Summary")!;
  const executiveBody = nodes.findIndex(
    (node, index) =>
      index > executiveStart
      && index < projectStart
      && node.startsWith("<w:p")
      && paragraphStyle(node) === "BodyText"
      && Boolean(textOf(node)),
  );
  if (executiveBody < 0) throw new Error("report-template-executive-body-slot-missing");
  rebuilt[executiveBody] = bodyParagraph(nodes[executiveBody], executive.paragraphs.join(" "));

  const executiveTopics = plan.sections
    .filter((section) => section.heading !== "Executive Summary" && section.heading !== "Project Information")
    .filter((section) => section.paragraphs.length > 0 || section.tables.length > 0)
    .slice(0, 6);
  const executiveCells = ["TOPIC", "DESIGN POSITION"];
  for (const section of executiveTopics) executiveCells.push(section.heading, section.paragraphs[0] ?? "See report section.");
  while (executiveCells.length < 14) executiveCells.push("");
  if (executiveTable >= 0 && tableCellCount(nodes[executiveTable]) === executiveCells.length) {
    rebuilt[executiveTable] = replaceTableCells(nodes[executiveTable], executiveCells);
  }

  // The master is the page skeleton. Never rebuild its pages from selected
  // fragments: doing so changes floating-object anchors, section geometry,
  // TOC alignment, header spacing and footer tab stops. Populate only
  // verified in-place slots and retain every other source node in position.
  const orderedHeadingPositions = [...headingPositions.values()].sort((left, right) => left - right);
  for (const section of plan.sections) {
    if (section.heading === "Executive Summary" || section.heading === "Project Information") continue;
    if (section.paragraphs.length === 0 && section.tables.length === 0) continue;
    const position = headingPositions.get(section.heading)!;
    const nextHeading = orderedHeadingPositions.find((candidate) => candidate > position) ?? appendicesStart;
    const rangeEnd = Math.min(nextHeading, appendicesStart);
    const paragraphSlots = nodes
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          index > position
          && index < rangeEnd
          && node.startsWith("<w:p")
          && paragraphStyle(node) === "BodyText"
          && Boolean(textOf(node))
          && !/<w:drawing\b/.test(node)
          && !/<w:sectPr\b/.test(node),
      )
      .map(({ index }) => index);
    for (const [paragraphIndex, paragraph] of section.paragraphs.entries()) {
      const slot = paragraphSlots[paragraphIndex];
      if (slot === undefined) break;
      rebuilt[slot] = bodyParagraph(nodes[slot], paragraph);
    }

    const tableSlots = nodes
      .map((node, index) => ({ node, index }))
      .filter(({ node, index }) => index > position && index < rangeEnd && node.startsWith("<w:tbl"))
      .map(({ index }) => index);
    for (const [tableIndex, table] of section.tables.entries()) {
      const slot = tableSlots[tableIndex];
      if (slot === undefined) break;
      const values = [...table.columns, ...table.rows.flat()];
      if (tableCellCount(nodes[slot]) !== values.length) continue;
      rebuilt[slot] = replaceTableCells(nodes[slot], values);
    }
  }

  const sampleIdentityRuns = new Map<string, string>([
    ["Letterkenny", plan.metadata.projectName],
    ["Letterkenny,", plan.metadata.address ? `${plan.metadata.address},` : `${plan.metadata.projectName},`],
    ["J2769", plan.metadata.projectNumber ?? "-"],
    ["VHA", plan.metadata.client ?? "-"],
    ["VHA Architects", plan.metadata.client ?? "the Client"],
    ["LKPH1-IAC-XX-XX-RP-Y-0001", resolvedDocumentNumber],
  ]);
  for (let index = 0; index < rebuilt.length; index += 1) {
    rebuilt[index] = replaceExactRuns(rebuilt[index], sampleIdentityRuns);
    rebuilt[index] = normalizeCoverLabel(rebuilt[index]);
    rebuilt[index] = normalizeApprovalLabel(rebuilt[index]);
    rebuilt[index] = normalizeCaption(rebuilt[index]);
    rebuilt[index] = normalizeCompactSubheading(rebuilt[index]);
    rebuilt[index] = normalizeSectionSubheading(rebuilt[index]);
    rebuilt[index] = normalizeComponentParagraph(rebuilt[index]);
    rebuilt[index] = forceParagraphStart(rebuilt[index]);
    rebuilt[index] = polishEndIdentity(rebuilt[index]);
    rebuilt[index] = polishEndOfReport(rebuilt[index], resolvedDocumentNumber, resolvedRevision);
    rebuilt[index] = markTextRunsAsPresentation(rebuilt[index]);
  }
  alignDisclaimerContinuation(rebuilt);
  normalizeDisclaimerLayout(rebuilt);
  normalizeInternalFlowBreaks(rebuilt);
  normalizeHeadingIntroductions(rebuilt);
  protectCompactSubheadingIntroductions(rebuilt);
  protectParagraphsBeforeSectionBreaks(rebuilt);

  if (rebuilt.length !== sourceNodes.length) throw new Error("report-template-body-node-count-changed");
  const generatedBodyXml = rebuilt.join("");
  const sourceDrawingCount = (sourceXml.match(/<w:drawing\b/g) ?? []).length;
  const outputDrawingCount = (generatedBodyXml.match(/<w:drawing\b/g) ?? []).length;
  if (outputDrawingCount !== sourceDrawingCount) throw new Error("report-template-drawing-count-changed");
  const sourceTableCount = (sourceXml.match(/<w:tbl\b/g) ?? []).length;
  const outputTableCount = (generatedBodyXml.match(/<w:tbl\b/g) ?? []).length;
  if (outputTableCount !== sourceTableCount) throw new Error("report-template-table-count-changed");
  const sourceSectionCount = (sourceXml.match(/<w:sectPr\b/g) ?? []).length;
  const outputSectionCount = (generatedBodyXml.match(/<w:sectPr\b/g) ?? []).length;
  if (outputSectionCount !== sourceSectionCount) throw new Error("report-template-section-count-changed");

  outputArchive["word/document.xml"] = strToU8(`${open}${rebuilt.join("")}${close}`);
  const footer = outputArchive["word/footer1.xml"];
  if (footer) {
    outputArchive["word/footer1.xml"] = strToU8(
      markTextRunsAsPresentation(polishFooterIdentity(replaceExactRuns(
        strFromU8(footer),
        new Map<string, string>([
          ["LKPH1-IAC-XX-XX-RP-Y-0001", resolvedDocumentNumber],
          ["A", resolvedRevision],
          ["03/09/2026", shortDate],
        ]),
        false,
      ))),
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
