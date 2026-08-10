"use client";

import { useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, X } from "lucide-react";

export default function AttachPopover({
  onClose,
  onAttach,
}: {
  onClose: () => void;
  onAttach: (name: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [onClose]);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onAttach(files[0].name);
    onClose();
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-[calc(100%+10px)] left-0 w-[320px] bg-surface border border-line rounded-md shadow-xl z-30 flex flex-col gap-3 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[14px]">Attach files</span>
        <button onClick={onClose} aria-label="Close attach" className="text-muted hover:text-ink">
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center gap-2 border border-dashed rounded-md py-6 px-4 text-center transition-colors ${
          dragOver ? "border-primary bg-primary-tint" : "border-line hover:border-primary"
        }`}
      >
        <UploadCloud size={22} strokeWidth={1.6} className="text-primary" />
        <span className="text-[13px] font-medium">Drag files here, or click to browse</span>
        <span className="text-[11px] text-faint">PDF, DOCX or CSV · up to 40 MB</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex items-center gap-2 text-[11px] text-faint border-t border-line pt-3">
        <FileText size={13} strokeWidth={1.8} />
        Files stay attached to this conversation and can be cited in answers.
      </div>
    </div>
  );
}
