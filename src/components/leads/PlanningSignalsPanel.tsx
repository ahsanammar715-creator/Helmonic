"use client";

import { useState } from "react";
import { ChevronRight, ChevronLeft, Search, ArrowRight } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import { AssistantBubble } from "@/components/ChatBubble";
import {
  planningSuggestions,
  planningScanSteps,
  planningFunnel,
  planningSignals,
  PlanningStatus,
  PlanningFitBand,
} from "@/lib/data";

type Stage = "empty" | "scanning" | "results";

const fitBandStyle: Record<PlanningFitBand, string> = {
  High: "text-teal",
  Medium: "text-amber",
  Low: "text-sub",
};

const statusStyle: Record<PlanningStatus, string> = {
  New: "text-primary border-primary",
  Review: "text-amber border-amber",
  Qualified: "text-teal border-teal",
  "Not pursuing": "text-faint border-line",
};

function StatusPill({ status }: { status: PlanningStatus }) {
  const cls = statusStyle[status].split(" ")[0];
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${statusStyle[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cls.replace("text-", "bg-")}`} />
      {status.toUpperCase()}
    </span>
  );
}

export default function PlanningSignalsPanel() {
  const [stage, setStage] = useState<Stage>("empty");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [signals, setSignals] = useState(planningSignals);

  const signal = selected !== null ? signals[selected] : null;

  function runScan() {
    setStage("scanning");
    setTimeout(() => setStage("results"), 800);
  }

  function markUnderReview() {
    if (selected === null) return;
    setSignals((prev) =>
      prev.map((s, i) => (i === selected ? { ...s, status: "Review" } : s))
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
          {stage === "empty" && (
            <div className="max-w-[620px] flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
                  iA
                </span>
                <span className="text-[11px] font-semibold text-faint tracking-[0.08em]">
                  IACOUSTICS · IRELAND
                </span>
              </div>
              <h3 className="m-0 font-bold text-[24px] tracking-tight">
                Find projects that are starting to need acoustic expertise.
              </h3>
              <p className="m-0 text-[14px] text-muted">
                Helmonic scans Irish planning activity via BuildingInfo for acoustic RFIs and
                noise-related conditions, and flags projects where a useful contact — like the
                architect — is already identified.
              </p>
              <div className="flex flex-col gap-2">
                {planningSuggestions.map((s) => (
                  <button
                    key={s}
                    onClick={runScan}
                    className="text-left border border-line rounded-md px-3.5 py-3 text-[13px] hover:border-primary hover:text-primary flex items-center gap-2.5"
                  >
                    <Search size={14} strokeWidth={1.8} className="text-faint shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stage === "scanning" && (
            <div className="max-w-[560px] flex flex-col gap-2 text-[13px] text-sub">
              <span className="font-semibold text-[16px] text-ink">
                Scanning Irish planning activity…
              </span>
              {planningScanSteps.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}

          {stage === "results" && (
            <>
              <AssistantBubble>
                <p className="m-0 text-[14px] leading-[1.65]">
                  Scan complete. After checking planning documents for acoustic terminology and
                  identifying the parties involved, {planningFunnel[3].value} projects show a
                  strong iAcoustics fit.
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  {planningFunnel.map((f, i) => (
                    <span key={f.label} className="flex items-center gap-1.5">
                      <span className="border border-line rounded px-2 py-1 text-sub">
                        {f.value} {f.label}
                      </span>
                      {i < planningFunnel.length - 1 && (
                        <ArrowRight size={12} strokeWidth={1.8} className="text-faint" />
                      )}
                    </span>
                  ))}
                </div>
              </AssistantBubble>

              <div className="border border-line rounded-md bg-surface overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-[1.4fr_0.6fr_1fr_1.4fr_0.65fr_1fr_0.5fr_1fr] bg-primary-tint-2 text-[10px] font-semibold tracking-[0.05em] text-sub min-w-[900px]">
                  <div className="px-3 py-2.5">PROJECT</div>
                  <div className="px-2 py-2.5">COUNTY</div>
                  <div className="px-2 py-2.5">STAGE</div>
                  <div className="px-2 py-2.5">ACOUSTIC SIGNAL</div>
                  <div className="px-2 py-2.5">VALUE</div>
                  <div className="px-2 py-2.5">ARCHITECT</div>
                  <div className="px-2 py-2.5">FIT</div>
                  <div className="px-2 py-2.5">STATUS</div>
                </div>
                {signals.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setSelected(i)}
                    className={`w-full grid grid-cols-[1.4fr_0.6fr_1fr_1.4fr_0.65fr_1fr_0.5fr_1fr] min-w-[900px] border-t border-line-soft text-[12px] text-left items-center ${
                      selected === i ? "bg-primary-tint-2" : "hover:bg-canvas"
                    }`}
                  >
                    <div className="px-3 py-2.5 min-w-0">
                      <div className="font-semibold truncate">{s.project}</div>
                      <div className="text-faint text-[11px] truncate">{s.sector}</div>
                    </div>
                    <div className="px-2 py-2.5 text-sub truncate">{s.county}</div>
                    <div className="px-2 py-2.5 text-sub truncate">{s.stage}</div>
                    <div className="px-2 py-2.5 min-w-0">
                      <span className="inline-block border border-amber rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber leading-[1.3]">
                        {s.signalType}
                      </span>
                    </div>
                    <div className="px-2 py-2.5 text-sub truncate">{s.value}</div>
                    <div className="px-2 py-2.5 text-sub truncate">{s.architect ?? "Not identified"}</div>
                    <div className={`px-2 py-2.5 font-semibold ${fitBandStyle[s.fitBand]}`}>
                      {s.fitScore}
                    </div>
                    <div className="px-2 py-2.5">
                      <StatusPill status={s.status} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <ChatComposer
          placeholder="Scan Irish planning activity for acoustic RFIs and noise conditions."
          helper="Project facts are shown separately from Helmonic analysis. Every claim keeps its source."
          onSend={runScan}
        />
      </div>

      {stage === "results" &&
        (panelOpen ? (
          <div className="hidden lg:flex w-[420px] shrink-0 border-l border-line bg-surface flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="flex items-center justify-center w-6 h-6 border border-line rounded-md bg-surface text-sub cursor-pointer hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                  aria-label="Collapse planning signal panel"
                >
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
                <span className="text-[11px] font-semibold tracking-[0.09em] text-muted">
                  PLANNING SIGNAL
                </span>
              </span>
            </div>
            <div className="flex-1 px-5 py-4 flex flex-col gap-3.5 overflow-auto">
              {!signal ? (
                <div className="flex flex-col gap-3 text-[13px] text-sub">
                  <span>Select a project from the list to see its full intelligence record.</span>
                  <div className="border border-line rounded-md p-3.5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">SCAN</span>
                    <span className="font-semibold text-[14px]">Irish planning activity · BuildingInfo</span>
                    <span className="text-[12px] text-muted">
                      {planningFunnel[3].value} strong-fit opportunities · last refresh today
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">PROJECT</span>
                    <span className="font-bold text-[16px]">{signal.project}</span>
                    <span className="text-[12px] text-muted">
                      {signal.county} · {signal.sector}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="border border-line rounded px-2 py-1 text-sub">{signal.stage}</span>
                    <span className="border border-line rounded px-2 py-1 text-sub">{signal.value}</span>
                    <StatusPill status={signal.status} />
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[12px]">
                    {signal.keyDates.map((d) => (
                      <div key={d.label} className="flex items-center justify-between">
                        <span className="text-sub">{d.label}</span>
                        <span className="font-semibold">{d.date}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border border-line rounded-md p-3 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-faint tracking-[0.07em]">FIT SCORE</span>
                    <span className={`font-extrabold text-[26px] tracking-tight tabular-nums ${fitBandStyle[signal.fitBand]}`}>
                      {signal.fitScore}
                      <span className="text-[13px] font-semibold ml-1.5 align-middle">{signal.fitBand}</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      ACOUSTIC TRIGGER
                    </span>
                    <div className="border border-line rounded-md p-3 text-[12px] text-sub leading-[1.55]">
                      &ldquo;{signal.acousticTrigger}&rdquo;
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      SOURCE EVIDENCE
                    </span>
                    <div className="border border-line rounded-md p-3 flex flex-col gap-0.5">
                      <span className="font-semibold text-[13px]">{signal.source.name}</span>
                      <span className="text-[11px] text-faint">{signal.source.meta}</span>
                      <span className="text-[12px] text-sub">{signal.source.note}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[12px]">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      PARTIES INVOLVED
                    </span>
                    <div className="flex justify-between">
                      <span className="text-sub">Applicant / Developer</span>
                      <span className="font-semibold text-right">{signal.applicant}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sub">Planning agent</span>
                      <span className="font-semibold text-right">{signal.planningAgent ?? "Not identified"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sub">Architect</span>
                      <span className="font-semibold text-right">{signal.architect ?? "Not identified"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sub">Main contractor</span>
                      <span className="font-semibold text-right">{signal.mainContractor ?? "Not identified"}</span>
                    </div>
                    {signal.otherParties.map((p) => (
                      <div key={p} className="flex justify-between">
                        <span className="text-sub">Other</span>
                        <span className="font-semibold text-right">{p}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border border-line rounded-md bg-canvas p-3 text-[12px] leading-[1.55] text-sub">
                    <span className="font-semibold text-ink">Helmonic analysis · </span>
                    {signal.analysis}
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3 mt-auto">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">NEXT STEP</span>
                    <button
                      onClick={markUnderReview}
                      disabled={signal.status === "Review"}
                      className="rounded-md bg-primary text-white px-3.5 py-2.5 text-[13px] font-semibold text-center hover:bg-primary-hover disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {signal.status === "Review" ? "Under review" : "Review opportunity"}
                    </button>
                    <div
                      title="Not yet available"
                      className="flex items-center justify-center gap-1.5 rounded-md border border-line px-3.5 py-2.5 text-[13px] font-semibold text-faint opacity-40"
                    >
                      Approve outreach
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
            <button
              onClick={() => setPanelOpen(true)}
              aria-label="Expand planning signal panel"
              className="flex items-center justify-center w-7 h-7 border border-line rounded-md bg-surface text-primary cursor-pointer hover:border-primary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
    </div>
  );
}
