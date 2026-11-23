"use client";

import { useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, X } from "lucide-react";

export default function AttachPopover({
  onClose,
  onAttach,
  accept = ".pdf,.doc,.docx,.csv",
  formats = "PDF, DOCX or CSV · up to 40 MB",
}: {
  onClose: () => void;
  onAttach: (file: File, promoteToKnowledge: boolean) => void;
  accept?: string;
  formats?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [promoteToKnowledge, setPromoteToKnowledge] = useState(false);
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
    onAttach(files[0], promoteToKnowledge);
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
        <span className="text-[11px] text-faint">{formats}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <label className="flex items-start gap-2.5 rounded-md border border-line bg-canvas px-3 py-2.5 text-[12px] leading-[1.45]">
        <input
          type="checkbox"
          checked={promoteToKnowledge}
          onChange={(event) => setPromoteToKnowledge(event.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          <span className="block font-semibold text-ink">Add to Helmonic knowledge</span>
          <span className="block text-faint">
            Keep an audited permanent copy in the separate company-knowledge RAG after
            processing and duplicate checks.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-2 text-[11px] text-faint border-t border-line pt-3">
        <FileText size={13} strokeWidth={1.8} />
        Unchecked files stay conversation-scoped and can be cited as attachment evidence.
      </div>
    </div>
  );
}
