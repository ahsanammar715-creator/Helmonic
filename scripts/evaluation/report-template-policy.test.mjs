import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportTemplateDescriptor,
  buildReportTemplatePackageManifest,
  verifyReportTemplateBytes,
} from "../../src/lib/consult/report-template-policy.ts";

test("editable and visual masters are separate immutable artifacts", () => {
  const editableMaster = buildReportTemplateDescriptor({
    templateId: "acoustic-report",
    version: "v4-final",
    originalFileName: "Acoustic Report Revamp v4 final - Gibson.docx",
    bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]),
  });
  const visualMaster = buildReportTemplateDescriptor({
    templateId: "acoustic-report",
    version: "v4-final",
    originalFileName: "Acoustic Report Revamp v4 final.pdf",
    bytes: new TextEncoder().encode("%PDF-1.7\nlayout-master"),
  });
  const manifest = buildReportTemplatePackageManifest({ editableMaster, visualMaster });
  assert.match(editableMaster.blobName, /^acoustic-report\/v4-final\/[a-f0-9]{64}\.docx$/);
  assert.match(visualMaster.blobName, /^acoustic-report\/v4-final\/[a-f0-9]{64}\.pdf$/);
  assert.equal(manifest.typography.primaryFamily, "Gibson");
  assert.equal(verifyReportTemplateBytes(editableMaster.byteLength === 5 ? new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01]) : new Uint8Array(), editableMaster), true);
});

test("invalid or altered masters fail closed", () => {
  assert.throws(() => buildReportTemplateDescriptor({ templateId: "noise", version: "v1", originalFileName: "template.txt", bytes: new Uint8Array([1]) }), /must-be-docx-or-pdf/);
  assert.throws(() => buildReportTemplateDescriptor({ templateId: "noise", version: "v1", originalFileName: "template.pdf", bytes: new TextEncoder().encode("not a PDF") }), /invalid-pdf/);
  assert.throws(() => verifyReportTemplateBytes(new Uint8Array([2]), { sha256: "0".repeat(64), byteLength: 1 }), /hash-mismatch/);
});
