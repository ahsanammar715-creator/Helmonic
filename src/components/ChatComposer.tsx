"use client";

import { useState } from "react";
import { Paperclip, ArrowRight } from "lucide-react";

export default function ChatComposer({
  placeholder,
  helper,
  onSend,
  disabled = false,
}: {
  placeholder: string;
  helper?: string;
  onSend?: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  function submit() {
    if (!value.trim() || disabled) return;
    onSend?.(value.trim());
    setValue("");
  }

  return (
    <div className="px-6 md:px-10 pb-5 pt-3.5 flex flex-col gap-2">
      <div className="flex items-center gap-3 border border-line rounded-md bg-surface px-3.5 py-3">
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 border border-line rounded-md text-[13px] text-primary hover:bg-primary-tint-2 hover:border-primary shrink-0"
        >
          <Paperclip size={15} strokeWidth={1.6} />
          Attach
        </button>
        <input
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
