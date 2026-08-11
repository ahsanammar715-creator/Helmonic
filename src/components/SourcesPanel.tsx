"use client";

import { useSessionBoolean } from "@/lib/useSessionBoolean";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { sourcesCited } from "@/lib/data";
import SourcesList from "@/components/SourcesList";

export default function SourcesPanel({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const [isOpen, setOpen] = useSessionBoolean("helmonic.sources", defaultOpen);

  function toggle() {
    setOpen(!isOpen);
  }

  if (!isOpen) {
    return (
      <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Expand Sources panel"
          className="flex items-center justify-center w-7 h-7 border border-line rounded-md bg-surface text-primary cursor-pointer hover:border-primary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
        >
          <ChevronLeft size={14} strokeWidth={1.8} />
        </button>
        <span
          className="text-[11px] font-semibold text-sub tracking-[0.09em]"
          style={{ writingMode: "vertical-rl" }}
        >
          SOURCES · {sourcesCited.length}
        </span>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex w-[320px] shrink-0 border-l border-line bg-surface flex-col">
      <div className="flex items-center justify-between px-[18px] py-4 border-b border-line">
        <span className="flex items-center gap-2 font-semibold text-[14px]">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={true}
            aria-label="Collapse Sources panel"
            className="flex items-center justify-center w-6 h-6 border border-line rounded-md bg-surface text-sub cursor-pointer hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          >
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
          Sources
        </span>
        <span className="flex items-center gap-2.5">
          <span className="text-[12px] text-faint">{sourcesCited.length}</span>
          <span
            title="Add documents"
            className="flex items-center justify-center w-6 h-6 border border-line rounded-md text-primary hover:border-primary hover:bg-primary-tint-2"
          >
            <Plus size={13} strokeWidth={2} />
          </span>
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-3 px-[18px] py-4 overflow-auto">
        <SourcesList />
      </div>
      <div className="px-[18px] pb-5 text-[11px] text-faint text-center">
        Citations link back to the page they came from.
      </div>
    </div>
  );
}
