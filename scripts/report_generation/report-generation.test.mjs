import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { buildGroundedReportDocx } from "../../src/lib/consult/reports/docx.ts";
import {
  buildGroundedReportPlan,
  filterUngroundedReportContent,
  filterUnsupportedReportClaims,
  reportPayloadClaimText,
  reportEvidenceBoundaryInstruction,
  reportModelEvidenceCharacterBudget,
  reportExecutiveSummaryMaximumParagraphCharacters,
  reportExecutiveSummaryMaximumParagraphs,
  reportModelMaximumCompletionTokens,
  reportModelReasoningEffort,
  selectReportModelCitations,
} from "../../src/lib/consult/reports/policy.ts";

test("administrative report fields cannot masquerade as evidence", () => {
  assert.match(reportEvidenceBoundaryInstruction, /metadata.*not evidence/i);
  assert.match(reportEvidenceBoundaryInstruction, /revisions or dates/i);
  assert.match(reportEvidenceBoundaryInstruction, /Never expand, normalize or infer an address/i);
});

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

function drawingParagraph(text, style = "BodyText") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>`;
}

function template() {
  const body = [
      '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr></w:p>',
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
    paragraph("STATUS OF THE DESIGN", "Normal"),
    '<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>SETTLED</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>IN DEVELOPMENT</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>AWAITED FROM OTHERS</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>sample settled work</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>sample developing work</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>sample awaited work</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '<w:p><w:pPr><w:sectPr><w:pgMar w:top="1400" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols w:num="1"/></w:sectPr></w:pPr></w:p>',
    paragraph("Project Information", "Heading1"),
    paragraph("Project DescriptionLetterkenny SURS Phase 1"),
    paragraph("Project NumberJ2769"),
    paragraph("ClientVHA"),
    paragraph("Site / AddressLetterkenny, Co Donegal"),
    paragraph("Report TitleAcoustic Report"),
    paragraph("Document NumberLKPH1-IAC-XX-XX-RP-Y-0001"),
    paragraph("Table of Contents", "Normal"),
    '<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>MASTER TOC ENTRIES</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:pPr><w:spacing w:line="254" w:lineRule="exact"/></w:pPr><w:hyperlink w:anchor="s6"><w:r><w:rPr><w:rFonts w:ascii="Gibson Condensed"/><w:i/><w:spacing w:val="12"/><w:w w:val="85"/><w:sz w:val="22"/></w:rPr><w:t>6 Building Services Noise</w:t></w:r></w:hyperlink></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:hyperlink w:anchor="s6a"><w:r><w:rPr><w:rFonts w:ascii="Gibson Condensed"/><w:i/><w:w w:val="75"/><w:sz w:val="18"/></w:rPr><w:t>6.1 General Requirements</w:t></w:r></w:hyperlink></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:spacing w:val="-8"/><w:sz w:val="24"/></w:rPr><w:t>Appendix A — Design Standards &amp; Guidance</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    '<w:p><w:pPr><w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:cols/></w:sectPr></w:pPr></w:p>',
    ...mainHeadings.flatMap((heading) => [
      paragraph(heading, "Heading1"),
      paragraph(`SAMPLE ${heading}`),
      ...(heading === "Internal Sound Insulation"
        ? [
            '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:rPr><w:spacing w:val="30"/><w:u w:val="single"/></w:rPr><w:t>Figure 3-1   Site location showing receptors</w:t></w:r></w:p>',
            '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:spacing w:before="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:spacing w:val="20"/><w:sz w:val="22"/></w:rPr><w:t>Internal Partition Junction Typical Detail</w:t></w:r></w:p>',
          ]
        : []),
      ...(heading === "Room Acoustics"
        ? [
            '<w:p><w:pPr><w:pStyle w:val="BodyText"/></w:pPr><w:r><w:t>The site is in Letter</w:t></w:r><w:r><w:t>kenny.</w:t></w:r></w:p>',
            '<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>Cellular Office Spaces · Event B01-18 · LEED v4.1 · BS ISO 22955</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
            paragraph("Event B01-18*", "Normal"),
            paragraph("Open-Plan Office B01-029", "Normal"),
            drawingParagraph("Gyproc SoundBloc PSR A206199 A206047"),
          ]
        : []),
      ...(heading === "Introduction"
        ? [drawingParagraph("L2–L4 delivered shell and core · Cat B fit-out at Level B-1")]
        : []),
      ...(heading === "Inward Noise & Building Envelope Assessment"
        ? [drawingParagraph("drop site plan — receptor locations"), paragraph("Figure 3-1 Site location showing receptors", "Normal")]
        : []),
      ...(heading === "Acoustic Performance Specification"
        ? ['<w:tbl><w:tblPr/><w:tblGrid/><w:tr><w:tc><w:p><w:r><w:t>COL 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>COL 2</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>VALUE 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>VALUE 2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>']
        : []),
    ]),
    paragraph("A–D Appendices", "Normal"),
    paragraph("Design Standards & Guidance", "Heading4"),
    paragraph("ATTACHED", "Normal"),
    paragraph("Acoustic Performance Schedules", "Heading4"),
    paragraph("ATTACHED", "Normal"),
    paragraph("Acoustic Scope Drawings", "Heading4"),
    paragraph("ATTACHED", "Normal"),
    paragraph("Glossary of Acoustic Terminology", "Heading4"),
    paragraph("ATTACHED", "Normal"),
    '<w:p><w:pPr><w:spacing w:before="199"/><w:ind w:left="112" w:right="129" w:firstLine="2329"/><w:jc w:val="left"/></w:pPr><w:r><w:br w:type="column"/></w:r><w:r><w:t>End of report </w:t></w:r><w:r><w:t>LKPH1-IAC-XX-XX-RP-Y-0001</w:t></w:r><w:r><w:t> · Revision </w:t></w:r><w:r><w:t>A</w:t></w:r></w:p>',
    '<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>',
  ].join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`),
    "word/styles.xml": strToU8(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Gibson"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`),
    "word/settings.xml": strToU8('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'),
    "word/header1.xml": strToU8('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>STATIC HEADER</w:t></w:r></w:p></w:hdr>'),
    "word/footer1.xml": strToU8('<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>STATIC FOOTER</w:t></w:r><w:r><w:txbxContent><w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>LKPH1-IAC-XX-XX-RP-Y-0001</w:t></w:r><w:r><w:t> · Revision </w:t></w:r><w:r><w:t>A</w:t></w:r><w:r><w:t> · 03/09/2026</w:t></w:r></w:p></w:txbxContent></w:r></w:p></w:ftr>'),
    "word/media/logo.png": new Uint8Array([1, 2, 3]),
  });
}

const citation = { id: "chunk-1", title: "Grounded acoustic report", sourceId: "source-1", excerpt: "The measured rating level was 45 dB LAr,T.", citationNamespace: "D", marker: "D1" };

function plan() {
  return buildGroundedReportPlan({
    reportId: "report-1",
    requestedByObjectId: "11111111-1111-4111-8111-111111111111",
    instruction: "Prepare a concise environmental noise report.",
    metadata: { reportTitle: "Environmental Noise Assessment", projectName: "Example Project", projectNumber: "J2701", issueDate: "2026-09-25" },
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

test("report generation omits uncited model content without weakening the evidence gate", () => {
  const filtered = filterUngroundedReportContent({
    sections: [
      {
        heading: "Executive Summary",
        paragraphs: ["Grounded statement. [D1]", "Consultant input required."],
        tables: [],
      },
      {
        heading: "Acoustic Performance Specification",
        paragraphs: [],
        tables: [
          {
            title: "Criteria",
            columns: ["Item", "Requirement"],
            rows: [
              ["Grounded item", "45 dB LAr,T [D1]"],
              ["Unsupported item", "To be confirmed"],
            ],
          },
          {
            title: "Unsupported table",
            columns: ["Item", "Requirement"],
            rows: [["Unsupported item", "To be confirmed"]],
          },
        ],
      },
    ],
  }, [citation]);

  assert.equal(filtered.removedParagraphCount, 1);
  assert.equal(filtered.removedTableRowCount, 2);
  assert.equal(filtered.removedTableCount, 1);
  const result = buildGroundedReportPlan({
    reportId: "report-1",
    requestedByObjectId: "11111111-1111-4111-8111-111111111111",
    instruction: "Prepare report.",
    metadata: { reportTitle: "Report", projectName: "Project", issueDate: "2026-09-25" },
    sectionPayload: filtered.payload,
    citations: [citation],
    supplementaryAttachments: [],
  });
  assert.deepEqual(result.sections[0].paragraphs, ["Grounded statement. [D1]"]);
  assert.deepEqual(result.sections[3].tables[0].rows, [["Grounded item", "45 dB LAr,T [D1]"]]);
  assert.equal(result.sections[3].tables.length, 1);
});

test("report claim audit input includes every retained paragraph and factual table row", () => {
  const text = reportPayloadClaimText({
    sections: [
      {
        heading: "Executive Summary",
        paragraphs: ["Grounded summary. [D1]"],
        tables: [],
      },
      {
        heading: "Acoustic Performance Specification",
        paragraphs: ["Grounded criterion. [D2]"],
        tables: [
          {
            title: "Criteria",
            columns: ["Item", "Requirement"],
            rows: [["Bedroom partition", "45 dB Rw [D3]"]],
          },
        ],
      },
    ],
  });

  assert.equal(
    text,
    "Grounded summary. [D1]\n\nGrounded criterion. [D2]\n\nBedroom partition | 45 dB Rw [D3]",
  );
});

test("unsupported audited claims are omitted without discarding supported report content", () => {
  const filtered = filterUnsupportedReportClaims({
    sections: [
      {
        heading: "Executive Summary",
        paragraphs: ["Supported summary. [D1]", "Over-broad summary. [D1]"],
        tables: [],
      },
      {
        heading: "Acoustic Performance Specification",
        paragraphs: ["Supported criterion. [D1]"],
        tables: [
          {
            title: "Criteria",
            columns: ["Item", "Requirement"],
            rows: [
              ["Supported row", "45 dB Rw [D1]"],
              ["Over-broad row", "Enhanced performance [D1]"],
            ],
          },
          {
            title: "Unsupported table",
            columns: ["Item", "Requirement"],
            rows: [["Unsupported row", "Not entailed [D1]"]],
          },
        ],
      },
    ],
  }, ["C2", "C5", "C6"]);

  assert.equal(filtered.removedParagraphCount, 1);
  assert.equal(filtered.removedTableRowCount, 2);
  assert.equal(filtered.removedTableCount, 1);
  assert.deepEqual(filtered.payload.sections[0].paragraphs, ["Supported summary. [D1]"]);
  assert.deepEqual(filtered.payload.sections[1].paragraphs, ["Supported criterion. [D1]"]);
  assert.deepEqual(filtered.payload.sections[1].tables[0].rows, [
    ["Supported row", "45 dB Rw [D1]"],
  ]);
  assert.equal(filtered.payload.sections[1].tables.length, 1);
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
  assert.match(strFromU8(output["word/footer1.xml"]), /J2701/);
  assert.match(strFromU8(output["word/footer1.xml"]), /<w:jc w:val="center"\/>/);
  assert.match(strFromU8(output["word/footer1.xml"]), /<w:noProof\/>/);
  assert.doesNotMatch(strFromU8(output["word/footer1.xml"]), /Revision <\/w:t><\/w:r><w:r[^>]*><w:rPr[^>]*>[\s\S]*?<w:t>-<\/w:t>/);
  const documentXml = strFromU8(output["word/document.xml"]);
  assert.match(documentXml, /w:pgMar w:top="1440"/);
  assert.match(documentXml, /Example Project/);
  assert.match(documentXml, /ENVIRONMENTAL NOISE ASSESSMENT/);
  assert.match(documentXml, /\[D1\]/);
  assert.match(documentXml, /Rating level/);
  assert.doesNotMatch(documentXml, /The measured rating level was 45 dB LAr,T\.:/);
  assert.doesNotMatch(documentXml, /MASTER TOC ENTRIES/);
  assert.match(documentXml, /TOC \\o "1-4" \\h \\z \\u/);
  assert.match(documentXml, /Appendix A — Design Standards &amp; Guidance/);
  assert.match(documentXml, /w:dirty="true"/);
  assert.doesNotMatch(documentXml, /Figure 3-1\s{2,}Site/);
  assert.match(documentXml, /Figure 3-1 Site location showing receptors/);
  assert.match(documentXml, /Internal Partition Junction Typical Detail/);
  assert.match(documentXml, /<w:spacing[^>]*w:before="82"/);
  assert.match(documentXml, /<w:u w:val="none"\/>/);
  assert.doesNotMatch(documentXml, /<w:u w:val="single"\/>/);
  assert.match(documentXml, /<w:jc w:val="right"\/>[\s\S]*?<w:br\/>[\s\S]*?<w:t>J2701<\/w:t>/);
  assert.match(documentXml, /PROJECT IMAGE PLACEHOLDER/);
  assert.match(documentXml, /A–D Appendices/);
  assert.doesNotMatch(documentXml, />ATTACHED</);
  assert.equal((documentXml.match(/NOT INCLUDED IN THIS DRAFT/g) ?? []).length, 4);
  assert.match(documentXml, /Consultant input required/);
  assert.match(documentXml, /Consultant input required — no grounded evidence was retrieved for this section\./);
  assert.doesNotMatch(documentXml, /updates automatically when this report opens/);
  assert.doesNotMatch(documentXml, /report-1/);
  assert.doesNotMatch(documentXml, /Letterkenny SURS|VHA Architects|J2769|LKPH1/);
  assert.doesNotMatch(documentXml, /The site is in (?:Letterkenny|Example Project)\./);
  assert.doesNotMatch(documentXml, /SAMPLE /);
  assert.doesNotMatch(documentXml, /COL 1|COL 2|VALUE 1|VALUE 2/);
  assert.doesNotMatch(documentXml, /Cellular Office Spaces|Event B01-18|Open-Plan Office B01-029|LEED v4\.1|BS ISO 22955|A206199|A206047|delivered shell and core/);
  assert.match(documentXml, /Figure 3-1 Site location showing receptors/);
  assert.match(strFromU8(output["word/settings.xml"]), /updateFields w:val="true"/);
  assert.ok(
    (documentXml.match(/<w:tbl\b/g) ?? []).length
      < (strFromU8(source["word/document.xml"] ?? new Uint8Array()).match(/<w:tbl\b/g) ?? []).length,
  );
  assert.ok((documentXml.match(/<w:pgMar\b/g) ?? []).length >= 1);
  assert.ok((documentXml.match(/<w:cols w:num="1"\/>/g) ?? []).length >= 1);
  assert.equal(
    (documentXml.match(/<w:sectPr\b/g) ?? []).length,
    (strFromU8(source["word/document.xml"] ?? new Uint8Array()).match(/<w:sectPr\b/g) ?? []).length,
  );
});

test("grounded section text is inserted even when the master starts with an empty BodyText shell paragraph", () => {
  const groundedPlan = plan();
  groundedPlan.sections = groundedPlan.sections.map((section) =>
    section.heading === "Introduction"
      ? { ...section, paragraphs: ["Grounded introduction text. [D1]"] }
      : section,
  );

  const output = unzipSync(buildGroundedReportDocx(template(), groundedPlan));
  const documentXml = strFromU8(output["word/document.xml"]);

  assert.match(documentXml, /Grounded introduction text\. \[D1\]/);
});

test("grounded report content may use a term that also appears in the master sample table", () => {
  const groundedPlan = plan();
  groundedPlan.sections = groundedPlan.sections.map((section) =>
    section.heading === "Room Acoustics"
      ? {
          ...section,
          paragraphs: [
            "Cellular Office Spaces require an evidence-led acoustic design response. [D1]",
          ],
        }
      : section,
  );

  const output = unzipSync(buildGroundedReportDocx(template(), groundedPlan));
  const documentXml = strFromU8(output["word/document.xml"]);

  assert.match(documentXml, /Cellular Office Spaces require an evidence-led acoustic design response/);
  assert.doesNotMatch(documentXml, /Cellular Office Spaces[^<]*(?:<[^>]+>)*[^<]*Event B01-18/);
  assert.doesNotMatch(documentXml, /LEED v4\.1[^<]*(?:<[^>]+>)*[^<]*BS ISO 22955/);
});
