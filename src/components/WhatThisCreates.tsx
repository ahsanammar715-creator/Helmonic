"use client";

import { useState } from "react";
import { ChevronDown, FileText, ListChecks, LineChart, PenLine } from "lucide-react";
import { whatThisCreates } from "@/lib/data";

const icons = [FileText, ListChecks, LineChart, PenLine];

export default function WhatThisCreates({ footer }: { footer: string }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="hidden xl:flex w-[300px] shrink-0 border-l border-line bg-canvas px-[22px] py-6 flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left hover:text-primary"
      >
        <span className="flex-1 text-[11px] font-semibold text-muted tracking-[0.09em]">
          WHAT THIS CREATES
        </span>
        <ChevronDown
          size={15}
          strokeWidth={1.8}
          className={`text-faint transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3.5">
          {whatThisCreates.map((item, i) => {
            const Icon = icons[i];
            return (
              <div key={item.title} className="flex gap-3">
                <span className="text-primary shrink-0 pt-0.5">
                  <Icon size={18} strokeWidth={1.6} />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-[13px]">{item.title}</span>
                  <span className="text-[12px] leading-[1.55] text-muted">{item.body}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-auto border border-line rounded-md bg-surface p-3.5 text-[12px] leading-[1.55] text-sub">
        {footer}
      </div>
    </div>
  );
}
