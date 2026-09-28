import "server-only";

import path from "node:path";

import { buildGroundedReportDocx } from "@/lib/consult/reports/docx";
import {
  buildGroundedReportPlan,
  reportModelMaximumCompletionTokens,
  selectReportModelCitations,
  sha256Attachment,
  validateReportMetadata,
} from "@/lib/consult/reports/policy";
import { reportSectionHeadings } from "@/lib/consult/reports/types";
import type { ConsultCitation } from "@/lib/consult/types";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";
import { putImmutableReportBlob } from "@/lib/server/report-output-blob";
import { loadConfiguredReportTemplate } from "@/lib/server/report-template-blob";

type ReportInputFile = { name: string; type: string; bytes: Uint8Array };

export class ReportModelRequestError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`report-model-${status}`);
    this.name = "ReportModelRequestError";
  }
}

function evidenceText(citations: ConsultCitation[]) {
  return citations
    .map((citation) => {
      const title = citation.citationNamespace === "B" ? "Approved book source" : citation.title;
      return `[${citation.marker ?? "D"}] ${title}\n${citation.excerpt}`;
    })
    .join("\n\n");
}

async function createSectionPayload(input: {
  config: RuntimeConfig;
  requestId: string;
  instruction: string;
  metadata: unknown;
  citations: ConsultCitation[];
}) {
  if (!input.config.model.endpoint || !input.config.model.deployment) throw new Error("report-model-not-configured");
  if (input.citations.length === 0) throw new Error("report-evidence-empty");
  const modelCitations = selectReportModelCitations(input.citations);
  if (modelCitations.length === 0) throw new Error("report-evidence-budget-empty");
  const token = await getAzureAccessToken("https://cognitiveservices.azure.com/.default");
  const response = await fetch(
    `${input.config.model.endpoint}/openai/deployments/${encodeURIComponent(input.config.model.deployment)}/chat/completions?api-version=${encodeURIComponent(input.config.model.apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": input.requestId,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content:
              "Prepare a technically exact acoustic report plan for a practising acoustic consultant. Use correct acoustic notation and terminology without explaining elementary concepts. Use only supplied evidence. Every factual paragraph must end with one or more exact supplied citation markers. The Executive Summary must contain paragraphs only and its tables array must be empty. In later sections, use tables only when the evidence contains genuinely comparable criteria, schedules, measurements or constructions; every factual table row must contain at least one exact supplied citation marker. Never invent values, clauses, measurements, standards or project facts. Return empty paragraphs and tables arrays where evidence is absent. Do not write placeholder prose about missing evidence.",
          },
          {
            role: "user",
            content: `Instruction:\n${input.instruction}\n\nProject metadata:\n${JSON.stringify(input.metadata)}\n\nRequired section headings:\n${reportSectionHeadings.join("\n")}\n\nEvidence:\n${evidenceText(modelCitations)}`,
          },
        ],
        reasoning_effort: input.config.model.reasoningEffort,
        max_completion_tokens: Math.min(
          input.config.model.maximumCompletionTokens,
          reportModelMaximumCompletionTokens,
        ),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "grounded_acoustic_report",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["sections"],
              properties: {
                sections: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["heading", "paragraphs", "tables"],
                    properties: {
                      heading: { type: "string", enum: reportSectionHeadings },
                      paragraphs: { type: "array", items: { type: "string" } },
                      tables: {
                        type: "array",
                        maxItems: 6,
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["title", "columns", "rows"],
                          properties: {
                            title: { type: "string" },
                            columns: {
                              type: "array",
                              minItems: 2,
                              maxItems: 6,
                              items: { type: "string" },
                            },
                            rows: {
                              type: "array",
                              minItems: 1,
                              maxItems: 30,
                              items: {
                                type: "array",
                                minItems: 2,
                                maxItems: 6,
                                items: { type: "string" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(input.config.model.timeoutMilliseconds),
    },
  );
  const responseBody = await response.text();
  if (!response.ok) throw new ReportModelRequestError(response.status, responseBody.slice(0, 8_192));
  const payload = JSON.parse(responseBody) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new ReportModelRequestError(response.status, responseBody.slice(0, 8_192));
  return JSON.parse(content) as unknown;
}

function safeName(name: string) {
  const extension = path.extname(name).toLowerCase();
  const stem = path.basename(name, extension).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 100) || "attachment";
  return `${stem}${extension}`;
}

export async function generateAndStoreReport(input: {
  config: RuntimeConfig;
  requestId: string;
  requestedByObjectId: string;
  instruction: string;
  metadata: unknown;
  citations: ConsultCitation[];
  files: ReportInputFile[];
}) {
  if (!input.config.reportGeneration.enabled) throw new Error("report-generation-disabled");
  const metadata = validateReportMetadata(input.metadata);
  if (input.files.length > input.config.reportGeneration.maximumAttachmentCount) throw new Error("report-attachment-count-exceeded");
  const totalBytes = input.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalBytes > input.config.reportGeneration.maximumAttachmentBytes) throw new Error("report-attachment-bytes-exceeded");

  const reportId = crypto.randomUUID();
  const attachmentDescriptors = input.files.map((file) => ({
    originalFileName: path.basename(file.name),
    contentType: file.type || "application/octet-stream",
    byteLength: file.bytes.byteLength,
    sha256: sha256Attachment(file.bytes),
    evidenceStatus: "stored-only" as const,
  }));
  const sectionPayload = await createSectionPayload({
    config: input.config,
    requestId: input.requestId,
    instruction: input.instruction,
    metadata,
    citations: input.citations,
  });
  const plan = buildGroundedReportPlan({
    reportId,
    requestedByObjectId: input.requestedByObjectId,
    instruction: input.instruction,
    metadata,
    sectionPayload,
    citations: input.citations,
    supplementaryAttachments: attachmentDescriptors,
  });
  const template = await loadConfiguredReportTemplate(input.config);
  const reportBytes = buildGroundedReportDocx(template.bytes, plan);
  const prefix = `${input.requestedByObjectId}/${reportId}`;

  const attachmentWrites = await Promise.all(
    input.files.map((file, index) =>
      putImmutableReportBlob({
        config: input.config,
        blobName: `${prefix}/attachments/${attachmentDescriptors[index].sha256}-${safeName(file.name)}`,
        bytes: file.bytes,
        contentType: file.type || "application/octet-stream",
        requestId: input.requestId,
      }),
    ),
  );
  attachmentWrites.forEach((write, index) => {
    plan.supplementaryAttachments[index].blobName = write.blobName;
  });
  const reportWrite = await putImmutableReportBlob({
    config: input.config,
    blobName: `${prefix}/report.docx`,
    bytes: reportBytes,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    requestId: input.requestId,
  });
  const manifestBytes = new TextEncoder().encode(
    `${JSON.stringify({ ...plan, reportBlobName: reportWrite.blobName, templateSha256: template.sha256 }, null, 2)}\n`,
  );
  const manifestWrite = await putImmutableReportBlob({
    config: input.config,
    blobName: `${prefix}/manifest.json`,
    bytes: manifestBytes,
    contentType: "application/json",
    requestId: input.requestId,
  });
  return {
    reportId,
    reportBlobName: reportWrite.blobName,
    manifestBlobName: manifestWrite.blobName,
    attachmentBlobNames: attachmentWrites.map((write) => write.blobName),
    citationCount: plan.citations.length,
    sectionCount: plan.sections.length,
    downloadUrl: `/api/consult/reports/${reportId}/download`,
  };
}
