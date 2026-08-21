"use client";

import { useState } from "react";
import { Paperclip, ArrowRight, X } from "lucide-react";
import AttachPopover from "./AttachPopover";

export default function ChatComposer({
  placeholder,
  helper,
  onSend,
  disabled = false,
  attachLabel = "Attach",
  inputId,
  showAttach = true,
}: {
  placeholder: string;
  helper?: string;
  onSend?: (value: string) => void;
  disabled?: boolean;
  attachLabel?: string;
  inputId?: string;
  showAttach?: boolean;
}) {
  const [value, setValue] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);

  function submit() {
    if (!value.trim() || disabled) return;
    onSend?.(value.trim());
    setValue("");
  }

  return (
    <div className="px-6 md:px-10 pb-5 pt-3.5 flex flex-col gap-2">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="flex items-center gap-2 border border-line rounded-md bg-surface px-2.5 py-1.5 text-[12px]"
            >
              <Paperclip size={12} strokeWidth={1.8} className="text-faint" />
              {name}
              <button
                onClick={() => setAttachments((a) => a.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${name}`}
                className="text-faint hover:text-ink"
              >
                <X size={12} strokeWidth={1.8} />
              </button>
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
                onAttach={(name) => setAttachments((a) => [...a, name])}
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
