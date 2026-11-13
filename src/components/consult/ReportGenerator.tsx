"use client";

import { useState } from "react";
import { Download, FileText, Paperclip } from "lucide-react";

import type { ConsultConversationSummary } from "@/lib/consult/organization";
import type { SessionDocument, SessionDocumentUploadResponse } from "@/lib/consult/uploads";

type GenerationResult = {
  reportId: string;
  attachmentBlobNames: string[];
  citationCount: number;
  sectionCount: number;
  downloadUrl: string;
};

const terminalDocumentFailures = new Set([
  "quarantined",
  "failed",
  "expired",
  "deleted",
]);

function reportEvidenceTitle(projectName: string, projectNumber: string) {
  const project = projectNumber.trim()
    ? `${projectNumber.trim()} · ${projectName.trim()}`
    : projectName.trim();
  return `Report evidence · ${project}`.slice(0, 200);
}

async function findOrCreateEvidenceConversation(
  projectName: string,
  projectNumber: string,
  createIfMissing: boolean,
) {
  const title = reportEvidenceTitle(projectName, projectNumber);
  const listResponse = await fetch("/api/consult/conversations", { cache: "no-store" });
  if (!listResponse.ok) {
    if (!createIfMissing) return undefined;
    const payload = (await listResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || "Private report evidence is not enabled.");
  }
  const listPayload = (await listResponse.json()) as {
    conversations?: ConsultConversationSummary[];
  };
  const existing = listPayload.conversations?.find((conversation) => conversation.title === title);
  if (existing) return existing.id;
  if (!createIfMissing) return undefined;

  const createResponse = await fetch("/api/consult/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const createPayload = (await createResponse.json()) as {
    conversation?: ConsultConversationSummary;
    error?: string;
  };
  if (!createResponse.ok || !createPayload.conversation?.id) {
    throw new Error(createPayload.error || "The private report evidence workspace could not be created.");
  }
  return createPayload.conversation.id;
}

async function uploadEvidenceDocument(conversationId: string, file: File) {
  const response = await fetch(
    `/api/consult/conversations/${encodeURIComponent(conversationId)}/documents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "x-helmonic-file-name": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  const payload = (await response.json()) as SessionDocumentUploadResponse | { error?: string };
  if (!response.ok || !("document" in payload)) {
    throw new Error("error" in payload && payload.error ? payload.error : `Could not upload ${file.name}.`);
  }
  return payload.document.id;
}

async function waitForEvidenceDocument(documentId: string) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `/api/consult/documents/${encodeURIComponent(documentId)}/status`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as { document?: SessionDocument; error?: string };
    if (!response.ok || !payload.document) {
      throw new Error(payload.error || "The supplementary document status could not be checked.");
    }
    if (payload.document.state === "ready" || payload.document.state === "duplicate") {
      return payload.document.state;
    }
    if (terminalDocumentFailures.has(payload.document.state)) {
      throw new Error(
        `${payload.document.displayName} could not become verified report evidence (${payload.document.state}).`,
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error("Supplementary document extraction did not finish within two minutes. Try again shortly.");
}

export default function ReportGenerator() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"idle" | "working" | "complete" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<GenerationResult | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("working");
    setMessage("");
    setResult(null);
    const form = new FormData(event.currentTarget);
    const metadata = {
      reportTitle: String(form.get("reportTitle") ?? ""),
      projectName: String(form.get("projectName") ?? ""),
      projectSubtitle: String(form.get("projectSubtitle") ?? ""),
      address: String(form.get("address") ?? ""),
      client: String(form.get("client") ?? ""),
      projectNumber: String(form.get("projectNumber") ?? ""),
      documentNumber: String(form.get("documentNumber") ?? ""),
      revision: String(form.get("revision") ?? ""),
      issueDate: new Date().toISOString().slice(0, 10),
    };
    form.set("metadata", JSON.stringify(metadata));
    try {
      const invalidFile = files.find(
        (file) => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"),
      );
      if (invalidFile) throw new Error(`${invalidFile.name} is not a PDF.`);

      setMessage(files.length > 0 ? "Preparing private supplementary evidence…" : "Retrieving grounded evidence…");
      const conversationId = await findOrCreateEvidenceConversation(
        metadata.projectName,
        metadata.projectNumber,
        files.length > 0,
      );
      let attachmentDocumentIds: string[] = [];
      if (files.length > 0) {
        if (!conversationId) throw new Error("Private report evidence is not enabled.");
        setMessage(`Uploading ${files.length} supplementary PDF${files.length === 1 ? "" : "s"}…`);
        attachmentDocumentIds = await Promise.all(
          files.map((file) => uploadEvidenceDocument(conversationId, file)),
        );
        setMessage("Extracting and verifying supplementary evidence…");
        await Promise.all(attachmentDocumentIds.map(waitForEvidenceDocument));
      }
      if (conversationId) form.set("conversationId", conversationId);
      form.set("attachmentDocumentIds", JSON.stringify(attachmentDocumentIds));
      for (const file of files) form.append("attachments", file);
      setMessage("Generating the grounded Word report…");
      const response = await fetch("/api/consult/reports", { method: "POST", body: form });
      const payload = (await response.json()) as GenerationResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Report generation failed.");
      setResult(payload);
      setStatus("complete");
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Report generation failed.");
    }
  }

  return (
    <div className="min-h-full overflow-auto bg-canvas px-5 py-7 md:px-10">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-[820px] flex-col gap-5">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.08em] text-faint">CONSULT · GROUNDED REPORT</span>
          <h1 className="mb-1 mt-2 text-[25px] font-bold tracking-tight">Generate from the approved master</h1>
          <p className="m-0 max-w-[720px] text-[13px] leading-[1.6] text-muted">
            The cover, margins, headers, footers, typography and table of contents come from the approved iAcoustics Word master. Project content is generated only from retrieved evidence.
          </p>
        </div>

        <div className="grid gap-3 rounded-md border border-line bg-surface p-4 sm:grid-cols-2">
          {[
            ["projectName", "Project name", true],
            ["reportTitle", "Report title", true],
            ["projectSubtitle", "Project subtitle", false],
            ["address", "Site / address", false],
            ["client", "Client", false],
            ["projectNumber", "Project number", false],
            ["documentNumber", "Document number", false],
            ["revision", "Revision", false],
          ].map(([name, label, required]) => (
            <label key={String(name)} className="flex flex-col gap-1.5 text-[11px] font-semibold text-sub">
              {label}
              <input name={String(name)} required={Boolean(required)} className="rounded-md border border-line bg-canvas px-3 py-2 text-[13px] font-normal text-ink outline-none focus:border-primary" />
            </label>
          ))}
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold text-sub sm:col-span-2">
            Report instruction
            <textarea name="instruction" required rows={5} placeholder="Prepare the project acoustic design report, focusing on the approved criteria and unresolved items." className="resize-y rounded-md border border-line bg-canvas px-3 py-2 text-[13px] font-normal leading-[1.5] text-ink outline-none focus:border-primary" />
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line bg-surface p-4 hover:border-primary">
          <Paperclip size={18} className="text-primary" />
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-[12px] font-semibold">Attach supplementary documents</span>
            <span className="text-[11px] text-muted">PDFs are stored in a separate private project evidence workspace, extracted and verified before they can support this or a future report.</span>
          </span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="sr-only"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </label>

        {files.length > 0 && <div className="flex flex-wrap gap-2">{files.map((file) => <span key={`${file.name}-${file.size}`} className="rounded border border-line bg-surface px-2.5 py-1.5 text-[11px] text-sub">{file.name} · {(file.size / 1024).toFixed(1)} KB</span>)}</div>}

        <button type="submit" disabled={status === "working"} className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
          <FileText size={16} />
          {status === "working" ? "Generating grounded report…" : "Generate report"}
        </button>

        {status === "working" && message && (
          <div role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3 text-[12px] text-sub">
            {message}
          </div>
        )}
        {status === "failed" && <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-[12px] text-warning">{message}</div>}
        {status === "complete" && result && (
          <div className="rounded-md border border-teal/40 bg-teal/5 p-4 text-[12px] text-sub">
            <div className="font-semibold text-teal">Report package created</div>
            <div className="mt-1">{result.sectionCount} sections · {result.citationCount} grounded citations · {result.attachmentBlobNames.length} supplementary files</div>
            <a href={result.downloadUrl} className="mt-3 inline-flex items-center gap-2 rounded-md bg-teal px-3 py-2 font-semibold text-white hover:opacity-90"><Download size={14} />Download Word report</a>
          </div>
        )}
      </form>
    </div>
  );
}
