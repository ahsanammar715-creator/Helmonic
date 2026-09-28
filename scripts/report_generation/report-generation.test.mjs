import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { buildGroundedReportDocx } from "../../src/lib/consult/reports/docx.ts";
import {
  buildGroundedReportPlan,
  reportModelEvidenceCharacterBudget,
  reportExecutiveSummaryMaximumParagraphCharacters,
  reportExecutiveSummaryMaximumParagraphs,
  reportModelMaximumCompletionTokens,
  reportModelReasoningEffort,
  selectReportModelCitations,
} from "../../src/lib/consult/reports/policy.ts";

const headings = [
  "Executive Summary",
  "Project Information",
  "Introduction",
  "Acoustic Performance Specification",
  "Inward Noise & Building Envelope Assessment",
  "Internal Sound Insulation",
  "Room Acoustics",
  "Building Services Noise",
  "Construction, Inspection & Commissioning",
];

const mainHeadings = headings.filter(
  (heading) => heading !== "Executive Summary" && heading !== "Project Information",
);

function paragraph(text, style = "BodyText") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function template() {
  const body = [
    paragraph("A C O U S T I C R E P O R T", "Normal"),
    paragraph("Letterkenny SURS", "Title"),
    paragraph("Phase 1 — Alpha Innovation Centre", "Normal"),
    paragraph("Letterkenny, Co Donegal · Prepared for VHA", "Normal"),
    paragraph("I S S U E D 0 3 S E P T E M B E R 2 0 2 6", "Normal"),
    paragraph("VHA", "Normal"),
    paragraph("J2769", "Normal"),
    paragraph("A — 03/09/2026", "Normal"),
    paragraph("LKPH1-IAC-XX-XX-RP-Y-0001", "Normal"),
    paragraph("ACOUSTIC DESIGN REPORT", "Normal"),
    paragraph("Executive Summary", "Heading1"),
    paragraph("SAMPLE Executive Summary"),
    '<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>SAMPLE TABLE</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '<w:p><w:pPr><w:sectPr><w:pgMar w:top="1400" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="1"/></w:sectPr></w:pPr></w:p>',
    paragraph("Project Information", "Heading1"),
    paragraph("Project DescriptionLetterkenny SURS Phase 1"),
    paragraph("Project NumberJ2769"),
    paragraph("ClientVHA"),
    paragraph("Site / AddressLetterkenny, Co Donegal"),
    paragraph("Report TitleAcoustic Report"),
    paragraph("Document NumberLKPH1-IAC-XX-XX-RP-Y-0001"),
    paragraph("Table of Contents", "Normal"),
    '<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>MASTER TOC ENTRIES</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '<w:p><w:pPr><w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols/></w:sectPr></w:pPr></w:p>',
    ...mainHeadings.flatMap((heading) => [
      paragraph(heading, "Heading1"),
      paragraph(`SAMPLE ${heading}`),
      ...(heading === "Acoustic Performance Specification"
        ? ['<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>COL 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>COL 2</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>VALUE 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>VALUE 2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>']
        : []),
    ]),
    paragraph("A–D Appendices", "Normal"),
    paragraph("Design Standards & Guidance", "Heading4"),
    paragraph("Acoustic Performance Schedules", "Heading4"),
    paragraph("Acoustic Scope Drawings", "Heading4"),
    paragraph("Glossary of Acoustic Terminology", "Heading4"),
    '<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
  ].join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`),
    "word/styles.xml": strToU8(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Gibson"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`),
    "word/settings.xml": strToU8('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'),
    "word/header1.xml": strToU8('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>STATIC HEADER</w:t></w:r></w:p></w:hdr>'),
    "word/footer1.xml": strToU8('<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>STATIC FOOTER</w:t></w:r></w:p></w:ftr>'),
    "word/media/logo.png": new Uint8Array([1, 2, 3]),
  });
}

const citation = { id: "chunk-1", title: "Grounded acoustic report", sourceId: "source-1", excerpt: "The measured rating level was 45 dB LAr,T.", citationNamespace: "D", marker: "D1" };

function plan() {
  return buildGroundedReportPlan({
    reportId: "report-1",
    requestedByObjectId: "11111111-1111-4111-8111-111111111111",
    instruction: "Prepare a concise environmental noise report.",
    metadata: { reportTitle: "Environmental Noise Assessment", projectName: "Example Project", issueDate: "2026-09-25" },
    sectionPayload: {
      sections: [
        {
          heading: "Executive Summary",
          paragraphs: ["The measured rating level was 45 dB LAr,T. [D1]"],
          tables: [],
        },
        {
          heading: "Acoustic Performance Specification",
          paragraphs: [],
          tables: [
            {
              title: "Measured level",
              columns: ["Descriptor", "Value"],
              rows: [["Rating level", "45 dB LAr,T [D1]"]],
            },
          ],
        },
      ],
    },
    citations: [citation],
    supplementaryAttachments: [],
  });
}

test("report plans reject unsupported citations", () => {
  assert.throws(() => buildGroundedReportPlan({ reportId: "report-1", requestedByObjectId: "11111111-1111-4111-8111-111111111111", instruction: "Prepare report.", metadata: { reportTitle: "Report", projectName: "Project", issueDate: "2026-09-25" }, sectionPayload: { sections: [{ heading: "Executive Summary", paragraphs: ["Invented. [D2]"], tables: [] }] }, citations: [citation], supplementaryAttachments: [] }), /citation-invalid/);
});

test("report model evidence is bounded and remains balanced across project sources", () => {
  const citations = Array.from({ length: 80 }, (_, index) => ({
    id: `chunk-${index + 1}`,
    title: `Evidence ${index + 1}`,
    sourceId: index % 2 === 0 ? "source-a" : "source-b",
    excerpt: "x".repeat(420),
    citationNamespace: "D",
    marker: `D${index + 1}`,
  }));
  const selected = selectReportModelCitations(citations);
  assert.ok(selected.length > 4);
  assert.ok(selected.length < citations.length);
  assert.deepEqual(new Set(selected.map((item) => item.sourceId)), new Set(["source-a", "source-b"]));
  const serializedLength = selected.reduce(
    (total, item) => total + `[${item.marker}] ${item.title}\n${item.excerpt}\n\n`.length,
    0,
  );
  assert.ok(serializedLength <= reportModelEvidenceCharacterBudget);
  assert.equal(reportModelMaximumCompletionTokens, 4_800);
  assert.equal(reportModelReasoningEffort, "low");
});

test("report plans reject tables in the protected executive-summary layout", () => {
  assert.throws(() => buildGroundedReportPlan({ reportId: "report-1", requestedByObjectId: "11111111-1111-4111-8111-111111111111", instruction: "Prepare report.", metadata: { reportTitle: "Report", projectName: "Project", issueDate: "2026-09-25" }, sectionPayload: { sections: [{ heading: "Executive Summary", paragraphs: ["Grounded. [D1]"], tables: [{ title: "Not supported here", columns: ["A", "B"], rows: [["Grounded [D1]", "Grounded [D1]"]] }] }] }, citations: [citation], supplementaryAttachments: [] }), /executive-summary-tables-not-supported/);
});

test("report plans compact the executive summary to the protected layout capacity", () => {
  const result = buildGroundedReportPlan({
    reportId: "report-1",
    requestedByObjectId: "11111111-1111-4111-8111-111111111111",
    instruction: "Prepare report.",
    metadata: { reportTitle: "Report", projectName: "Project", issueDate: "2026-09-25" },
    sectionPayload: {
      sections: [{
        heading: "Executive Summary",
        paragraphs: [
          `${"Grounded evidence sentence. ".repeat(30)}[D1]`,
          `${"Second grounded evidence sentence. ".repeat(30)}[D1]`,
          "This third paragraph must not enter the protected shell. [D1]",
        ],
        tables: [],
      }],
    },
    citations: [citation],
    supplementaryAttachments: [],
  });
  const summary = result.sections.find((section) => section.heading === "Executive Summary");
  assert.equal(summary.paragraphs.length, reportExecutiveSummaryMaximumParagraphs);
  assert.ok(summary.paragraphs.every((paragraph) => paragraph.length <= reportExecutiveSummaryMaximumParagraphCharacters));
  assert.ok(summary.paragraphs.every((paragraph) => paragraph.endsWith("[D1]")));
});

test("generation clones the immutable master and changes approved text slots only", () => {
  const source = unzipSync(template());
  const output = unzipSync(buildGroundedReportDocx(template(), plan()));
  assert.deepEqual(output["word/media/logo.png"], new Uint8Array([1, 2, 3]));
  assert.match(strFromU8(output["word/header1.xml"]), /STATIC HEADER/);
  assert.match(strFromU8(output["word/footer1.xml"]), /STATIC FOOTER/);
  const documentXml = strFromU8(output["word/document.xml"]);
  assert.match(documentXml, /w:pgMar w:top="1440"/);
  assert.match(documentXml, /Example Project/);
  assert.match(documentXml, /ENVIRONMENTAL NOISE ASSESSMENT/);
  assert.match(documentXml, /\[D1\]/);
  assert.match(documentXml, /Rating level/);
  assert.doesNotMatch(documentXml, /The measured rating level was 45 dB LAr,T\.:/);
  assert.match(documentXml, /MASTER TOC ENTRIES/);
  assert.doesNotMatch(documentXml, /TOC \\o "1-2" \\h \\z \\u/);
  assert.match(documentXml, /A–D Appendices/);
  assert.doesNotMatch(documentXml, /updates automatically when this report opens/);
  assert.doesNotMatch(documentXml, /report-1/);
  assert.doesNotMatch(documentXml, /Letterkenny SURS|VHA Architects|J2769|LKPH1/);
  assert.doesNotMatch(documentXml, /SAMPLE Executive Summary/);
  assert.match(strFromU8(output["word/settings.xml"]), /updateFields w:val="true"/);
  assert.equal(
    (documentXml.match(/<w:tbl\b/g) ?? []).length,
    (strFromU8(source["word/document.xml"] ?? new Uint8Array()).match(/<w:tbl\b/g) ?? []).length,
  );
  assert.ok((documentXml.match(/<w:pgMar\b/g) ?? []).length >= 1);
  assert.ok((documentXml.match(/<w:cols w:num="1"\/>/g) ?? []).length >= 1);
  assert.equal(
    (documentXml.match(/<w:sectPr\b/g) ?? []).length,
    (strFromU8(source["word/document.xml"] ?? new Uint8Array()).match(/<w:sectPr\b/g) ?? []).length,
  );
});
