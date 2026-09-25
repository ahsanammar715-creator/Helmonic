import { createHash } from "node:crypto";
import path from "node:path";

export const reportTemplateContentTypes = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
} as const;

export type ReportTemplateExtension = keyof typeof reportTemplateContentTypes;
export type ReportTemplateContentType =
  (typeof reportTemplateContentTypes)[ReportTemplateExtension];

export type ReportTemplateDescriptor = {
  templateId: string;
  version: string;
  originalFileName: string;
  blobName: string;
  sha256: string;
  byteLength: number;
  extension: ReportTemplateExtension;
  contentType: ReportTemplateContentType;
};

export type ReportTemplatePackageManifest = {
  schemaVersion: 1;
  templateId: string;
  version: string;
  editableMaster: ReportTemplateDescriptor;
  visualMaster: ReportTemplateDescriptor;
  typography: {
    primaryFamily: "Gibson";
    preservedMonospaceFamily: "Consolas";
    fontsEmbedded: false;
  };
  authorities: { editableStructure: "editableMaster"; visualLayout: "visualMaster" };
  manifestSha256: string;
  manifestBlobName: string;
};

function safeSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) throw new Error(`invalid-${label}`);
  return normalized;
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildReportTemplateDescriptor(input: {
  templateId: string;
  version: string;
  originalFileName: string;
  bytes: Uint8Array;
}): ReportTemplateDescriptor {
  const extension = path.extname(input.originalFileName).toLowerCase() as ReportTemplateExtension;
  if (!(extension in reportTemplateContentTypes)) throw new Error("report-template-must-be-docx-or-pdf");
  if (input.bytes.byteLength === 0) throw new Error("report-template-empty");
  if (extension === ".pdf" && new TextDecoder("ascii").decode(input.bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("report-template-invalid-pdf");
  }
  if (extension === ".docx" && (input.bytes[0] !== 0x50 || input.bytes[1] !== 0x4b)) {
    throw new Error("report-template-invalid-docx");
  }
  const templateId = safeSegment(input.templateId, "template-id");
  const version = safeSegment(input.version, "template-version");
  const sha256 = sha256Bytes(input.bytes);
  return {
    templateId,
    version,
    originalFileName: path.basename(input.originalFileName),
    blobName: `${templateId}/${version}/${sha256}${extension}`,
    sha256,
    byteLength: input.bytes.byteLength,
    extension,
    contentType: reportTemplateContentTypes[extension],
  };
}

export function verifyReportTemplateBytes(
  bytes: Uint8Array,
  expected: Pick<ReportTemplateDescriptor, "sha256" | "byteLength">,
) {
  if (bytes.byteLength !== expected.byteLength) throw new Error("report-template-length-mismatch");
  if (sha256Bytes(bytes) !== expected.sha256) throw new Error("report-template-hash-mismatch");
  return true;
}

export function buildReportTemplatePackageManifest(input: {
  editableMaster: ReportTemplateDescriptor;
  visualMaster: ReportTemplateDescriptor;
}): ReportTemplatePackageManifest {
  const { editableMaster, visualMaster } = input;
  if (editableMaster.extension !== ".docx") throw new Error("editable-master-must-be-docx");
  if (visualMaster.extension !== ".pdf") throw new Error("visual-master-must-be-pdf");
  if (editableMaster.templateId !== visualMaster.templateId || editableMaster.version !== visualMaster.version) {
    throw new Error("report-template-package-identity-mismatch");
  }
  const payload = {
    schemaVersion: 1 as const,
    templateId: editableMaster.templateId,
    version: editableMaster.version,
    editableMaster,
    visualMaster,
    typography: {
      primaryFamily: "Gibson" as const,
      preservedMonospaceFamily: "Consolas" as const,
      fontsEmbedded: false as const,
    },
    authorities: {
      editableStructure: "editableMaster" as const,
      visualLayout: "visualMaster" as const,
    },
  };
  const manifestSha256 = sha256Bytes(new TextEncoder().encode(JSON.stringify(payload)));
  return {
    ...payload,
    manifestSha256,
    manifestBlobName: `${payload.templateId}/${payload.version}/${manifestSha256}.manifest.json`,
  };
}
