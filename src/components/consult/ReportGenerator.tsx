"use client";

import { useState } from "react";
import { Download, FileText, Paperclip } from "lucide-react";

type GenerationResult = {
  reportId: string;
  attachmentBlobNames: string[];
  citationCount: number;
  sectionCount: number;
  downloadUrl: string;
};

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
    for (const file of files) form.append("attachments", file);
    try {
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
            <span className="text-[11px] text-muted">Stored beside this report. Attachments do not become evidence unless they have passed the normal extraction and verification route.</span>
          </span>
          <input type="file" multiple className="sr-only" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        </label>

        {files.length > 0 && <div className="flex flex-wrap gap-2">{files.map((file) => <span key={`${file.name}-${file.size}`} className="rounded border border-line bg-surface px-2.5 py-1.5 text-[11px] text-sub">{file.name} · {(file.size / 1024).toFixed(1)} KB</span>)}</div>}

        <button type="submit" disabled={status === "working"} className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-[13px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
          <FileText size={16} />
          {status === "working" ? "Generating grounded report…" : "Generate report"}
        </button>

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
