"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronLeft, Search, ArrowRight } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import { AssistantBubble } from "@/components/ChatBubble";
import { leadFunnel, priorityLeads } from "@/lib/data";

type Stage = "empty" | "researching" | "results";

const suggestions = [
  "Research Berlin",
  "Find financially strong game studios in Munich",
  "Show German companies expanding audio production",
  "Find companies with Dolby Atmos capability",
];

export default function LeadGenerationPage() {
  const [stage, setStage] = useState<Stage>("empty");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const company = selected !== null ? priorityLeads[selected] : null;

  function runResearch() {
    setStage("researching");
    setTimeout(() => setStage("results"), 700);
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
          {stage === "empty" && (
            <div className="max-w-[620px] flex flex-col gap-3.5">
              <h3 className="m-0 font-bold text-[24px] tracking-tight">
                Find the companies worth approaching.
              </h3>
              <p className="m-0 text-[14px] text-muted">
                Research organisations by market, financial capacity, growth and studio relevance,
                then build a focused Smart Studio target list.
              </p>
              <div className="flex flex-col gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={runResearch}
                    className="text-left border border-line rounded-md px-3.5 py-3 text-[13px] hover:border-primary hover:text-primary flex items-center gap-2.5"
                  >
                    <Search size={14} strokeWidth={1.8} className="text-faint shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stage === "researching" && (
            <div className="max-w-[560px] flex flex-col gap-2 text-[13px] text-sub">
              <span className="font-semibold text-[16px] text-ink">Researching Berlin…</span>
              <span>Discovering relevant organisations</span>
              <span>Checking financial strength</span>
              <span>Reviewing growth and hiring signals</span>
              <span>Mapping decision-makers</span>
            </div>
          )}

          {stage === "results" && (
            <>
              <AssistantBubble>
                <p className="m-0 text-[14px] leading-[1.65]">
                  Berlin research complete. After reviewing industry fit, financial capacity,
                  growth signals and current investment indicators, {leadFunnel[5].value} companies
                  appear strong enough for detailed review.
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  {leadFunnel.map((f, i) => (
                    <span key={f.label} className="flex items-center gap-1.5">
                      <span className="border border-line rounded px-2 py-1 text-sub">
                        {f.value} {f.label}
                      </span>
                      {i < leadFunnel.length - 1 && (
                        <ArrowRight size={12} strokeWidth={1.8} className="text-faint" />
                      )}
                    </span>
                  ))}
                </div>
              </AssistantBubble>

              <div className="border border-line rounded-md bg-surface overflow-hidden">
                <div className="grid grid-cols-[28px_1.6fr_0.7fr_0.7fr_0.9fr_1fr] bg-primary-tint-2 text-[10px] font-semibold tracking-[0.05em] text-sub">
                  <div className="px-2 py-2.5" />
                  <div className="px-2 py-2.5">COMPANY</div>
                  <div className="px-2 py-2.5">FIT</div>
                  <div className="px-2 py-2.5">INTENT</div>
                  <div className="px-2 py-2.5">CAPACITY</div>
                  <div className="px-2 py-2.5">TRIGGER</div>
                </div>
                {priorityLeads.map((c, i) => (
                  <button
                    key={c.rank}
                    onClick={() => setSelected(i)}
                    className={`w-full grid grid-cols-[28px_1.6fr_0.7fr_0.7fr_0.9fr_1fr] border-t border-line-soft text-[12px] text-left ${
                      selected === i ? "bg-primary-tint-2" : "hover:bg-canvas"
                    }`}
                  >
                    <div className="px-2 py-2.5 text-faint">{c.rank}</div>
                    <div className="px-2 py-2.5 min-w-0">
                      <div className="font-semibold truncate">{c.name}</div>
                      <div className="text-faint text-[11px] truncate">
                        {c.city} · {c.sector}
                      </div>
                    </div>
                    <div className="px-2 py-2.5 font-semibold">{c.fit}</div>
                    <div className="px-2 py-2.5 font-semibold">{c.intent}</div>
                    <div className="px-2 py-2.5 text-sub">{c.capacity}</div>
                    <div className="px-2 py-2.5 text-sub truncate">{c.signals[0]}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <ChatComposer
          placeholder="Find 15 audio post-production companies in Berlin that could invest in a Smart Studio."
          helper="Company facts are shown separately from Helmonic analysis. Every claim keeps its source."
          onSend={runResearch}
        />
      </div>

      {stage === "results" &&
        (panelOpen ? (
          <div className="hidden lg:flex w-[400px] shrink-0 border-l border-line bg-surface flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <button onClick={() => setPanelOpen(false)} className="flex items-center gap-2 text-sub hover:text-primary" aria-label="Collapse intelligence panel">
                <ChevronRight size={15} strokeWidth={1.8} />
                <span className="text-[11px] font-semibold tracking-[0.09em] text-muted">
                  {company ? "COMPANY INTELLIGENCE" : "CAMPAIGN INTELLIGENCE"}
                </span>
              </button>
            </div>
            <div className="flex-1 px-5 py-4 flex flex-col gap-3.5 overflow-auto">
              {!company ? (
                <div className="flex flex-col gap-3 text-[13px] text-sub">
                  <span>Select a company from the list to see its full intelligence record.</span>
                  <div className="border border-line rounded-md p-3.5 flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">CAMPAIGN</span>
                    <span className="font-semibold text-[14px]">Berlin Audio Post 2026</span>
                    <span className="text-[12px] text-muted">
                      {leadFunnel[5].value} priority leads · last refresh today
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-[16px]">{company.name}</span>
                    <span className="text-[12px] text-muted">
                      {company.city} · {company.sector}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {[
                      ["Smart Studio Fit", company.fit],
                      ["Investment Intent", company.intent],
                    ].map(([label, val]) => (
                      <div key={label} className="border border-line rounded-md p-3 flex flex-col gap-0.5">
                        <span className="text-[10px] font-semibold text-faint tracking-[0.07em]">{label}</span>
                        <span className="font-bold text-[20px] text-primary">{val}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 text-[11px]">
                    <span className="border border-line rounded px-2 py-1 text-sub">
                      Capacity · {company.capacity}
                    </span>
                    <span className="border border-line rounded px-2 py-1 text-sub">
                      Evidence · {company.confidence}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">WHY THIS COMPANY</span>
                    {company.signals.map((s) => (
                      <span key={s} className="text-[13px] text-sub">
                        + {s}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 border-t border-line pt-3 text-[12px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-faint">Revenue</span>
                      <span className="font-semibold">{company.revenue}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-faint">Employees</span>
                      <span className="font-semibold">{company.employees}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[12px]">
                    <div className="flex justify-between">
                      <span className="text-sub">Economic buyer</span>
                      <span className="font-semibold">{company.economicBuyer}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sub">Technical buyer</span>
                      <span className="font-semibold">{company.technicalBuyer}</span>
                    </div>
                  </div>

                  <div className="border border-line rounded-md bg-canvas p-3 text-[12px] leading-[1.55] text-sub">
                    <span className="font-semibold text-ink">Helmonic analysis · </span>
                    {company.analysis}
                  </div>

                  <Link
                    href="/socials/marketing"
                    className="mt-auto rounded-md bg-primary text-white px-3.5 py-2.5 text-[13px] font-semibold text-center hover:bg-primary-hover"
                  >
                    Prepare outreach
                  </Link>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
            <button
              onClick={() => setPanelOpen(true)}
              aria-label="Expand intelligence panel"
              className="flex items-center justify-center w-7 h-7 border border-line rounded-md text-primary hover:border-primary hover:bg-primary-tint-2"
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
          </div>
        ))}
    </div>
  );
}
