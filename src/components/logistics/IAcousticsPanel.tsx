"use client";

import { useState } from "react";
import { ChevronRight, ChevronLeft, BookOpen, Plus } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import WaveDivider from "@/components/WaveDivider";
import {
  iAcousticsEngagements,
  iAcousticsTravelPlans,
  EngagementStatus,
  TravelPlanStatus,
} from "@/lib/data";

const engagementStatusStyle: Record<EngagementStatus, string> = {
  Scheduled: "text-primary border-primary",
  "Awaiting dates": "text-muted border-line",
  Planning: "text-amber border-amber",
};

const travelStatusStyle: Record<TravelPlanStatus, string> = {
  "Awaiting approval": "text-primary border-primary",
  "Recheck required": "text-amber border-amber",
  Booked: "text-teal border-teal",
  Approved: "text-primary border-primary",
};

function StatusDot({ className }: { className: string }) {
  return <span className={`w-1.5 h-1.5 rounded-full ${className.split(" ")[0].replace("text-", "bg-")}`} />;
}

export default function IAcousticsPanel() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const needsAttention = iAcousticsTravelPlans.filter((p) => p.status === "Recheck required").length;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
          <div className="flex items-start justify-between gap-4 max-w-[900px]">
            <div className="flex flex-col gap-1.5">
              <h3 className="m-0 font-bold text-[22px] tracking-tight">
                Plan and cost iAcoustics site visits.
              </h3>
              <div className="w-[110px]">
                <WaveDivider color="var(--color-primary)" />
              </div>
              <p className="m-0 text-[14px] text-muted max-w-[520px]">
                Select an engagement and describe the visit. Helmonic researches transport and
                accommodation for consultants doing measurement and survey work, builds a cost
                estimate, and tracks it from draft to actual cost.
              </p>
            </div>
            <button className="shrink-0 flex items-center gap-1.5 rounded-md bg-primary text-white px-3.5 py-2.5 text-[13px] font-semibold hover:bg-primary-hover">
              <Plus size={15} strokeWidth={2} />
              Create Logistics plan
            </button>
          </div>

          <div className="border border-line rounded-md bg-surface overflow-hidden max-w-[900px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[13px]">iAcoustics engagements</span>
              <span className="text-[11px] text-faint">Select an engagement to continue conversationally</span>
            </div>
            {iAcousticsEngagements.map((e, i) => (
              <button
                key={e.name}
                onClick={() => setSelected(i)}
                className={`w-full text-left flex items-center gap-4 px-4 py-3 border-t border-line-soft first:border-t-0 ${
                  selected === i ? "bg-primary-tint-2" : "hover:bg-canvas"
                }`}
              >
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] font-semibold truncate">{e.name}</span>
                  <span className="text-[12px] text-faint truncate">{e.client}</span>
                </div>
                <span className="text-[13px] text-sub w-[90px] shrink-0">{e.city}</span>
                <span className="text-[13px] text-sub w-[110px] shrink-0">{e.dates}</span>
                <span
                  className={`shrink-0 flex items-center gap-1.5 border rounded px-2 py-1 text-[11px] font-semibold ${engagementStatusStyle[e.status]}`}
                >
                  <StatusDot className={engagementStatusStyle[e.status]} />
                  {e.status.toUpperCase()}
                </span>
              </button>
            ))}
          </div>

          <div className="border border-line rounded-md bg-surface overflow-hidden max-w-[900px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <span className="font-semibold text-[13px]">Engagement travel plans</span>
              {needsAttention > 0 && (
                <span className="text-[11px] text-amber font-semibold">
                  {needsAttention} needs attention
                </span>
              )}
            </div>
            {iAcousticsTravelPlans.map((p) => (
              <div
                key={p.engagement}
                className="flex items-center gap-4 px-4 py-3 border-t border-line-soft first:border-t-0"
              >
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[13px] font-semibold truncate">{p.engagement}</span>
                  <span className="text-[12px] text-faint truncate">{p.note}</span>
                </div>
                <span className="text-[12px] text-faint w-[90px] shrink-0">{p.when}</span>
                <span className="text-[13px] font-semibold w-[70px] shrink-0">{p.cost}</span>
                <span
                  className={`shrink-0 flex items-center gap-1.5 border rounded px-2 py-1 text-[11px] font-semibold ${travelStatusStyle[p.status]}`}
                >
                  <StatusDot className={travelStatusStyle[p.status]} />
                  {p.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ChatComposer
          placeholder={
            selected !== null
              ? `Describe the ${iAcousticsEngagements[selected].name.toLowerCase()} visit…`
              : "Describe a visit, or select an engagement above to begin…"
          }
          helper="All monetary values default to EUR. Estimates are indicative until booked."
          attachLabel="Attach itinerary or quotation"
        />
      </div>

      {panelOpen ? (
        <div className="hidden lg:flex w-[380px] shrink-0 border-l border-line bg-surface flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <button
              onClick={() => setPanelOpen(false)}
              aria-label="Collapse logistics plan"
              className="flex items-center gap-2 text-sub hover:text-primary"
            >
              <ChevronRight size={15} strokeWidth={1.8} />
              <span className="text-[11px] font-semibold tracking-[0.09em] text-muted">
                LOGISTICS PLAN &amp; COST DRAFT
              </span>
            </button>
            <span className="text-[11px] text-faint">Updated just now</span>
          </div>
          <div className="flex-1 px-5 py-4 flex flex-col min-h-0">
            {selected === null ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
                <BookOpen size={26} strokeWidth={1.5} className="text-faint" />
                <p className="m-0 text-[13px] text-muted leading-[1.55]">
                  Select an engagement or start describing a visit. The plan, cost draft and
                  sources will build here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">ENGAGEMENT</span>
                  <span className="font-semibold text-[14px]">{iAcousticsEngagements[selected].name}</span>
                  <span className="text-[12px] text-muted">
                    {iAcousticsEngagements[selected].client} · {iAcousticsEngagements[selected].city}
                  </span>
                </div>
                <div className="border border-line rounded-md p-3 text-[12px] text-sub leading-[1.55] bg-canvas">
                  No draft yet. Describe the visit in the conversation to start building the cost
                  draft and travel plan for this engagement.
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
          <button
            onClick={() => setPanelOpen(true)}
            aria-label="Expand logistics plan"
            className="flex items-center justify-center w-7 h-7 border border-line rounded-md text-primary hover:border-primary hover:bg-primary-tint-2"
          >
            <ChevronLeft size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
}
