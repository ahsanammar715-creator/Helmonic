"use client";

import { useState } from "react";
import SmartStudioLeadsPanel from "@/components/leads/SmartStudioLeadsPanel";
import PlanningSignalsPanel from "@/components/leads/PlanningSignalsPanel";

type Mode = "smartStudio" | "iAcoustics";

export default function LeadGenerationPage() {
  const [mode, setMode] = useState<Mode>("smartStudio");

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-1 px-6 md:px-10 pt-4 border-b border-line">
        <button
          onClick={() => setMode("smartStudio")}
          className={`cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            mode === "smartStudio" ? "border-violet text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Smart Studio
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            SS
          </span>
        </button>
        <button
          onClick={() => setMode("iAcoustics")}
          className={`cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            mode === "iAcoustics" ? "border-violet text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          iAcoustics
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            iA
          </span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {mode === "smartStudio" ? <SmartStudioLeadsPanel /> : <PlanningSignalsPanel />}
      </div>
    </div>
  );
}
