import type { ConsultCitation } from "@/lib/consult/types";

export const reportSectionHeadings = [
  "Executive Summary",
  "Project Information",
  "Introduction",
  "Acoustic Performance Specification",
  "Inward Noise and Building Envelope Assessment",
  "Internal Sound Insulation",
  "Room Acoustics",
  "Building Services Noise",
  "Construction Inspection and Commissioning",
] as const;

export type ReportSectionHeading = (typeof reportSectionHeadings)[number];

export type ReportMetadata = {
  reportTitle: string;
  projectName: string;
  projectSubtitle?: string;
  address?: string;
  client?: string;
  projectNumber?: string;
  documentNumber?: string;
  revision?: string;
  issueDate: string;
};

export type GroundedReportSection = {
  heading: ReportSectionHeading;
  paragraphs: string[];
  tables: GroundedReportTable[];
};

export type GroundedReportTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

export type SupplementaryAttachment = {
  originalFileName: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  blobName?: string;
  evidenceStatus: "stored-only" | "included-as-text-evidence" | "already-indexed";
};

export type GroundedReportPlan = {
  schemaVersion: 2;
  reportId: string;
  createdAt: string;
  requestedByObjectId: string;
  instruction: string;
  metadata: ReportMetadata;
  sections: GroundedReportSection[];
  citations: ConsultCitation[];
  supplementaryAttachments: SupplementaryAttachment[];
};
