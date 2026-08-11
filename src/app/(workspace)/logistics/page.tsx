"use client";

import { useState } from "react";
import TopBar from "@/components/TopBar";
import SmartStudioPanel from "@/components/logistics/SmartStudioPanel";
import IAcousticsPanel from "@/components/logistics/IAcousticsPanel";

type Tab = "smartStudio" | "iAcoustics";

export default function LogisticsPage() {
  const [tab, setTab] = useState<Tab>("smartStudio");

  return (
    <div className="flex flex-col h-full min-w-0">
      <TopBar
        workspace="logistics"
        title="Logistics"
        subtitle={
          tab === "smartStudio"
            ? "Travel & site mobilisation · Smart Studio"
            : "Site visits & consultant travel · iAcoustics"
        }
        mode={tab === "smartStudio" ? "Linked to Build budget" : "Linked to Consult engagements"}
      />
      <div className="flex items-center gap-1 px-6 md:px-10 pt-4 border-b border-line">
        <button
          onClick={() => setTab("smartStudio")}
          className={`cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === "smartStudio" ? "border-amber text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Smart Studio
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            SS
          </span>
        </button>
        <button
          onClick={() => setTab("iAcoustics")}
          className={`cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px flex items-center gap-1.5 ${
            tab === "iAcoustics" ? "border-amber text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          iAcoustics
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            iA
          </span>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {tab === "smartStudio" ? <SmartStudioPanel /> : <IAcousticsPanel />}
      </div>
    </div>
  );
}
