"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft, Search, ArrowRight } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import { AssistantBubble } from "@/components/ChatBubble";
import { tenderSuggestions, tenderScanSteps, tenderFunnel, tenders, TenderStatus, TenderFitBand } from "@/lib/data";

type Stage = "empty" | "scanning" | "results";

const fitBandStyle: Record<TenderFitBand, string> = {
  High: "text-teal",
  Medium: "text-amber",
  Low: "text-sub",
};

const statusStyle: Record<TenderStatus, string> = {
  New: "text-primary border-primary",
  Review: "text-amber border-amber",
  Shortlisted: "text-teal border-teal",
  "Not pursuing": "text-faint border-line",
};

function StatusPill({ status }: { status: TenderStatus }) {
  const cls = statusStyle[status].split(" ")[0];
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${statusStyle[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cls.replace("text-", "bg-")}`} />
      {status.toUpperCase()}
    </span>
  );
}

export default function TenderIntelligencePage() {
  const [stage, setStage] = useState<Stage>("empty");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const tender = selected !== null ? tenders[selected] : null;

  function runScan() {
    setStage("scanning");
    setTimeout(() => setStage("results"), 800);
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
                  IACOUSTICS · IRELAND-WIDE
                </span>
              </div>
              <h3 className="m-0 font-bold text-[24px] tracking-tight">
                Find the Irish tenders worth pursuing.
              </h3>
              <p className="m-0 text-[14px] text-muted">
                Helmonic scans public procurement across Ireland – eTenders, TED, local
                authorities and public bodies like the OPW – for acoustic, noise and
                environmental consultancy opportunities, checks eligibility and deadlines, and
                ranks fit so the team can focus on the ones worth a proposal.
              </p>
              <div className="flex flex-col gap-2">
                {tenderSuggestions.map((s) => (
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
                Scanning Irish tender sources…
              </span>
              {tenderScanSteps.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}

          {stage === "results" && (
            <>
              <AssistantBubble>
                <p className="m-0 text-[14px] leading-[1.65]">
                  Scan complete. After checking acoustic and environmental relevance, eligibility
                  and deadlines, {tenderFunnel[3].value} opportunities show a strong iAcoustics
                  fit.
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  {tenderFunnel.map((f, i) => (
                    <span key={f.label} className="flex items-center gap-1.5">
                      <span className="border border-line rounded px-2 py-1 text-sub">
                        {f.value} {f.label}
                      </span>
                      {i < tenderFunnel.length - 1 && (
                        <ArrowRight size={12} strokeWidth={1.8} className="text-faint" />
                      )}
                    </span>
                  ))}
                </div>
              </AssistantBubble>

              <div className="border border-line rounded-md bg-surface overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-[1.4fr_0.9fr_0.75fr_0.5fr_0.7fr_0.75fr_1.2fr] bg-primary-tint-2 text-[10px] font-semibold tracking-[0.05em] text-sub min-w-[880px]">
                  <div className="px-3 py-2.5">TENDER</div>
                  <div className="px-2 py-2.5">BUYER</div>
                  <div className="px-2 py-2.5">SOURCE</div>
                  <div className="px-2 py-2.5">FIT</div>
                  <div className="px-2 py-2.5">LOCATION</div>
                  <div className="px-2 py-2.5">DEADLINE</div>
                  <div className="px-2 py-2.5">STATUS</div>
                </div>
                {tenders.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => setSelected(i)}
                    className={`w-full grid grid-cols-[1.4fr_0.9fr_0.75fr_0.5fr_0.7fr_0.75fr_1.2fr] min-w-[880px] border-t border-line-soft text-[12px] text-left items-center ${
                      selected === i ? "bg-primary-tint-2" : "hover:bg-canvas"
                    }`}
                  >
                    <div className="px-3 py-2.5 min-w-0">
                      <div className="font-semibold truncate">{t.title}</div>
                      <div className="text-faint text-[11px] truncate">{t.category}</div>
                    </div>
                    <div className="px-2 py-2.5 text-sub truncate">{t.buyer}</div>
                    <div className="px-2 py-2.5 text-sub truncate">{t.sourceSystem}</div>
                    <div className={`px-2 py-2.5 font-semibold ${fitBandStyle[t.fitBand]}`}>
                      {t.fitScore}
                    </div>
                    <div className="px-2 py-2.5 text-sub truncate">{t.location}</div>
                    <div className="px-2 py-2.5 text-sub truncate">{t.deadline}</div>
                    <div className="px-2 py-2.5">
                      <StatusPill status={t.status} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <ChatComposer
          placeholder="Scan Irish acoustic and environmental tenders relevant to iAcoustics."
          helper="Tender facts are shown separately from Helmonic analysis. Every claim keeps its source."
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
                  aria-label="Collapse tender intelligence panel"
                >
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
                <span className="text-[11px] font-semibold tracking-[0.09em] text-muted">
                  TENDER INTELLIGENCE
                </span>
              </span>
            </div>
            <div className="flex-1 px-5 py-4 flex flex-col gap-3.5 overflow-auto">
              {!tender ? (
                <div className="flex flex-col gap-3 text-[13px] text-sub">
                  <span>Select a tender from the list to see its full intelligence record.</span>
                  <div className="border border-line rounded-md p-3.5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">SCAN</span>
                    <span className="font-semibold text-[14px]">Irish acoustic &amp; environmental tenders</span>
                    <span className="text-[12px] text-muted">
                      {tenderFunnel[3].value} strong-fit opportunities · last refresh today
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-[16px]">{tender.title}</span>
                    <span className="text-[12px] text-muted">
                      {tender.buyer} · {tender.location}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className="border border-line rounded px-2 py-1 text-sub">
                      Closes {tender.deadline}
                    </span>
                    <span className="border border-line rounded px-2 py-1 text-sub">{tender.category}</span>
                    <span className="border border-line rounded px-2 py-1 text-sub">{tender.sourceSystem}</span>
                    <StatusPill status={tender.status} />
                  </div>

                  <div className="border border-line rounded-md p-3 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold text-faint tracking-[0.07em]">FIT SCORE</span>
                    <span className={`font-extrabold text-[26px] tracking-tight tabular-nums ${fitBandStyle[tender.fitBand]}`}>
                      {tender.fitScore}
                      <span className="text-[13px] font-semibold ml-1.5 align-middle">{tender.fitBand}</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">WHY IT FITS</span>
                    {tender.whyItFits.map((s) => (
                      <span key={s} className="text-[13px] text-sub">
                        + {s}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      MANDATORY REQUIREMENTS
                    </span>
                    {tender.mandatoryRequirements.map((r) => (
                      <span key={r} className="text-[13px] text-sub">
                        · {r}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">KEY DATES</span>
                    {tender.keyDates.map((d) => (
                      <div key={d.label} className="flex items-center justify-between text-[12px]">
                        <span className="text-sub">{d.label}</span>
                        <span className="font-semibold">{d.date}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">SCOPE</span>
                    <p className="m-0 text-[13px] text-sub leading-[1.55]">{tender.scope}</p>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      RISKS / GAPS
                    </span>
                    {tender.risks.map((r) => (
                      <span key={r} className="text-[13px] text-warning">
                        ! {r}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      SOURCE EVIDENCE
                    </span>
                    <div className="border border-line rounded-md p-3 flex flex-col gap-0.5">
                      <span className="font-semibold text-[13px]">{tender.source.name}</span>
                      <span className="text-[11px] text-faint">{tender.source.meta}</span>
                      <span className="text-[12px] text-sub">{tender.source.note}</span>
                    </div>
                  </div>

                  <div className="border border-line rounded-md bg-canvas p-3 text-[12px] leading-[1.55] text-sub">
                    <span className="font-semibold text-ink">Helmonic analysis · </span>
                    {tender.analysis}
                  </div>

                  <Link
                    href="/consult/new"
                    className="mt-auto rounded-md bg-primary text-white px-3.5 py-2.5 text-[13px] font-semibold text-center hover:bg-primary-hover"
                  >
                    Send to Consult
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
            <button
              onClick={() => setPanelOpen(true)}
              aria-label="Expand tender intelligence panel"
              className="flex items-center justify-center w-7 h-7 border border-line rounded-md bg-surface text-primary cursor-pointer hover:border-primary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
    </div>
  );
}
