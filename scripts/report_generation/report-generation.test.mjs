import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { buildGroundedReportDocx } from "../../src/lib/consult/reports/docx.ts";
import { buildGroundedReportPlan } from "../../src/lib/consult/reports/policy.ts";

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
    ...headings.flatMap((heading) => [
      paragraph(heading, "Heading1"),
      paragraph(`SAMPLE ${heading}`),
      ...(heading === "Project Information"
        ? [
            paragraph("Project DescriptionLetterkenny SURS Phase 1"),
            paragraph("Project NumberJ2769"),
            paragraph("ClientVHA"),
            paragraph("Site / AddressLetterkenny, Co Donegal"),
            paragraph("Report TitleAcoustic Report"),
            paragraph("Document NumberLKPH1-IAC-XX-XX-RP-Y-0001"),
          ]
        : []),
    ]),
    paragraph("Table of Contents", "Normal"),
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
    sectionPayload: { sections: [{ heading: "Executive Summary", paragraphs: ["The measured rating level was 45 dB LAr,T. [D1]"] }] },
    citations: [citation],
    supplementaryAttachments: [],
  });
}

test("report plans reject unsupported citations", () => {
  assert.throws(() => buildGroundedReportPlan({ reportId: "report-1", requestedByObjectId: "11111111-1111-4111-8111-111111111111", instruction: "Prepare report.", metadata: { reportTitle: "Report", projectName: "Project", issueDate: "2026-09-25" }, sectionPayload: { sections: [{ heading: "Executive Summary", paragraphs: ["Invented. [D2]"] }] }, citations: [citation], supplementaryAttachments: [] }), /citation-invalid/);
});

test("generation clones the immutable master and changes approved text slots only", () => {
  const source = unzipSync(template());
  const output = unzipSync(buildGroundedReportDocx(template(), plan()));
  assert.deepEqual(output["word/media/logo.png"], new Uint8Array([1, 2, 3]));
  assert.match(strFromU8(output["word/header1.xml"]), /STATIC HEADER/);
  assert.match(strFromU8(output["word/footer1.xml"]), /STATIC FOOTER/);
  const documentXml = strFromU8(output["word/document.xml"]);
  const sourceXml = strFromU8(source["word/document.xml"]);
  assert.match(documentXml, /w:pgMar w:top="1440"/);
  assert.match(documentXml, /Example Project/);
  assert.match(documentXml, /ENVIRONMENTAL NOISE ASSESSMENT/);
  assert.match(documentXml, /\[D1\]/);
  assert.doesNotMatch(documentXml, /Letterkenny SURS|VHA Architects|J2769|LKPH1/);
  assert.doesNotMatch(documentXml, /SAMPLE Executive Summary/);
  assert.deepEqual(output["word/settings.xml"], source["word/settings.xml"]);
  for (const tag of ["sectPr", "pgMar", "tbl", "drawing"]) {
    assert.equal((documentXml.match(new RegExp(`<w:${tag}\\b`, "g")) ?? []).length, (sourceXml.match(new RegExp(`<w:${tag}\\b`, "g")) ?? []).length);
  }
});
