"use client";

import { useState } from "react";
import { Paperclip, ArrowRight, X } from "lucide-react";
import AttachPopover from "./AttachPopover";
import type { ComposerAttachment } from "@/lib/consult/uploads";

export default function ChatComposer({
  placeholder,
  helper,
  onSend,
  disabled = false,
  attachLabel = "Attach",
  inputId,
  showAttach = true,
  onAttachFile,
  attachmentAccept,
  attachmentFormats,
}: {
  placeholder: string;
  helper?: string;
  onSend?: (value: string) => void;
  disabled?: boolean;
  attachLabel?: string;
  inputId?: string;
  showAttach?: boolean;
  onAttachFile?: (file: File) => Promise<ComposerAttachment>;
  attachmentAccept?: string;
  attachmentFormats?: string;
}) {
  const [value, setValue] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  async function attach(file: File) {
    const localId = crypto.randomUUID();
    setAttachments((current) => [
      ...current,
      { id: localId, name: file.name, state: "uploading" },
    ]);

    try {
      const completed = onAttachFile
        ? await onAttachFile(file)
        : { id: localId, name: file.name, state: "ready" as const };
      setAttachments((current) =>
        current.map((item) => (item.id === localId ? completed : item)),
      );
    } catch (error) {
      setAttachments((current) =>
        current.map((item) =>
          item.id === localId
            ? {
                ...item,
                state: "failed",
                error: error instanceof Error ? error.message : "Upload failed",
              }
            : item,
        ),
      );
    }
  }

  function submit() {
    if (!value.trim() || disabled) return;
    onSend?.(value.trim());
    setValue("");
  }

  return (
    <div className="px-6 md:px-10 pb-5 pt-3.5 flex flex-col gap-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="flex items-center gap-2 border border-line rounded-md bg-surface px-2.5 py-1.5 text-[12px]"
            >
              <Paperclip size={12} strokeWidth={1.8} className="text-faint" />
              <span className="max-w-[220px] truncate">{attachment.name}</span>
              <span
                className={attachment.state === "failed" ? "text-warning" : "text-faint"}
                title={attachment.error}
              >
                {attachment.state}
              </span>
              {attachment.state === "failed" && (
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                  aria-label={`Dismiss failed upload ${attachment.name}`}
                  className="text-faint hover:text-ink"
                >
                  <X size={12} strokeWidth={1.8} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 border border-line rounded-md bg-surface px-3.5 py-3">
        {showAttach && (
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAttachOpen((o) => !o)}
              aria-expanded={attachOpen}
              className="flex items-center gap-2 px-3 py-1.5 border border-line rounded-md text-[13px] text-primary hover:bg-primary-tint-2 hover:border-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <Paperclip size={15} strokeWidth={1.6} />
              {attachLabel}
            </button>
            {attachOpen && (
              <AttachPopover
                onClose={() => setAttachOpen(false)}
                onAttach={(file) => void attach(file)}
                accept={attachmentAccept}
                formats={attachmentFormats}
              />
            )}
          </div>
        )}
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 outline-none text-[14px] placeholder:text-faint bg-transparent min-w-0"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="flex items-center justify-center w-8 h-8 rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-40 shrink-0"
        >
          <ArrowRight size={16} strokeWidth={2} />
        </button>
      </div>
      {helper && <span className="text-[12px] text-faint">{helper}</span>}
    </div>
  );
}
