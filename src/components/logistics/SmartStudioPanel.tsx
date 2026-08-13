"use client";

import { useState } from "react";
import { ChevronRight, ChevronLeft, Check, MapPin } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import WaveDivider from "@/components/WaveDivider";
import { UserBubble, AssistantBubble } from "@/components/ChatBubble";
import { logisticsPrompts, logisticsMissingQuestions, logisticsScenarios } from "@/lib/data";

type Stage = "empty" | "missing" | "scenarios" | "approved";

export default function SmartStudioPanel() {
  const [stage, setStage] = useState<Stage>("empty");
  const [panelOpen, setPanelOpen] = useState(true);
  const [selected, setSelected] = useState(0);

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
          <div className="flex flex-col gap-1.5 max-w-[640px]">
            <h3 className="m-0 font-bold text-[24px] tracking-tight">
              Plan travel and site mobilisation.
            </h3>
            <div className="w-[110px]">
              <WaveDivider color="var(--color-amber)" />
            </div>
            <p className="m-0 text-[14px] text-muted">
              Describe the trip in plain language. Helmonic asks only for what is missing,
              researches transport and accommodation, and links the approved estimate to the
              project budget.
            </p>
          </div>

          {stage === "empty" && (
            <div className="max-w-[640px] flex flex-col gap-4">
              <div className="border border-line rounded-md bg-surface p-4 text-[13px] text-sub">
                No Smart Studio projects have a logistics plan yet. Start one below, or open it
                from Build once a project exists.
              </div>
              <div className="flex flex-col gap-2">
                {logisticsPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => setStage("missing")}
                    className="text-left border border-line rounded-md px-3.5 py-3 text-[13px] hover:border-primary hover:text-primary"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {stage !== "empty" && (
            <>
              <UserBubble>{logisticsPrompts[0]}</UserBubble>
              <AssistantBubble>
                <p className="m-0 text-[14px] leading-[1.65]">
                  Got it: Dublin to Berlin, four installers, eight nights. A few things I still
                  need:
                </p>
                <div className="flex flex-wrap gap-2">
                  {logisticsMissingQuestions.map((q) => (
                    <span key={q} className="border border-line rounded-md px-3 py-1.5 text-[12px] text-sub">
                      {q}
                    </span>
                  ))}
                </div>
                {stage === "missing" && (
                  <button
                    onClick={() => setStage("scenarios")}
                    className="self-start rounded-md bg-primary text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-primary-hover"
                  >
                    Research transport & accommodation
                  </button>
                )}
              </AssistantBubble>

              {stage !== "missing" && (
                <UserBubble>
                  Installation dates confirmed, site address is set, shared rooms are fine.
                </UserBubble>
              )}

              {stage !== "missing" && (
                <AssistantBubble>
                  <p className="m-0 text-[14px] leading-[1.65]">
                    Three scenarios, all costed in EUR. Prices may change – recheck before
                    booking.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {logisticsScenarios.map((s, i) => (
                      <button
                        key={s.name}
                        onClick={() => {
                          setSelected(i);
                          setStage("scenarios");
                        }}
                        className={`text-left rounded-md p-3.5 flex flex-col gap-1.5 ${
                          selected === i
                            ? "border border-primary bg-primary-tint-2"
                            : "border border-line hover:border-primary"
                        }`}
                      >
                        <span className="font-semibold text-[13px]">{s.name}</span>
                        <span className="text-[12px] text-muted">{s.detail}</span>
                        <span className="font-extrabold text-[20px] text-primary tracking-tight tabular-nums">{s.total}</span>
                        <span className="text-[11px] text-faint">{s.cancellation}</span>
                      </button>
                    ))}
                  </div>
                  {stage === "scenarios" && (
                    <button
                      onClick={() => setStage("approved")}
                      className="self-start rounded-md bg-primary text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-primary-hover"
                    >
                      Approve {logisticsScenarios[selected].name.split(" · ")[0]}
                    </button>
                  )}
                </AssistantBubble>
              )}

              {stage === "approved" && (
                <AssistantBubble>
                  <div className="flex items-center gap-2 text-teal font-semibold text-[14px]">
                    <Check size={17} strokeWidth={2} />
                    Approved and added to the Smart Studio build budget as a separate line.
                  </div>
                  <p className="m-0 text-[13px] text-sub">
                    Estimated until each item is booked. Export the plan, or track it from the
                    project register.
                  </p>
                  <div className="flex gap-2.5">
                    <button className="rounded-md bg-primary text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-primary-hover">
                      Export PDF
                    </button>
                    <button className="border border-line rounded-md px-3.5 py-2 text-[12px] font-semibold text-sub hover:border-primary hover:text-primary">
                      Export CSV
                    </button>
                  </div>
                </AssistantBubble>
              )}
            </>
          )}
        </div>

        <ChatComposer
          placeholder="Describe the trip, or answer Helmonic's question…"
          helper="All monetary values default to EUR. Estimates are indicative until booked."
          onSend={() => setStage("missing")}
        />
      </div>

      {panelOpen ? (
          <div className="hidden lg:flex w-[380px] shrink-0 border-l border-line bg-surface flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <span className="flex items-center gap-2 text-[11px] font-semibold text-muted tracking-[0.09em]">
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  aria-label="Collapse travel plan"
                  className="flex items-center justify-center w-6 h-6 border border-line rounded-md bg-surface text-sub cursor-pointer hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
                TRAVEL PLAN
              </span>
              {stage !== "empty" && (
                <span className="border border-line rounded px-2 py-0.5 text-[11px] text-sub">
                  {stage === "approved" ? "Approved" : stage === "scenarios" ? "Options ready" : "Researching"}
                </span>
              )}
            </div>
            {stage === "empty" ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
                <MapPin size={26} strokeWidth={1.5} className="text-faint" />
                <p className="m-0 text-[13px] text-muted leading-[1.55]">
                  Describe a trip in the conversation to start building the travel plan and cost
                  draft here.
                </p>
              </div>
            ) : (
            <div className="flex-1 px-5 py-4 flex flex-col gap-3 overflow-auto">
              <div className="flex items-center gap-2 text-[13px] text-sub">
                <MapPin size={15} strokeWidth={1.7} className="text-primary" />
                Dublin → Berlin · 4 installers · 8 nights
              </div>
              <div className="border border-line rounded-md h-[110px] bg-canvas flex items-center justify-center text-[12px] text-faint">
                Map preview
              </div>
              {stage !== "missing" && (
                <>
                  <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                    <span className="text-[11px] font-semibold text-faint tracking-[0.07em]">
                      SELECTED SCENARIO
                    </span>
                    <span className="text-[13px] font-semibold">
                      {logisticsScenarios[selected].name}
                    </span>
                    <span className="text-[12px] text-muted">{logisticsScenarios[selected].detail}</span>
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-[12px]">
                    <div className="flex justify-between">
                      <span className="text-sub">Cost per traveller</span>
                      <span className="font-semibold">{logisticsScenarios[selected].perTraveller}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sub">Cost per project day</span>
                      <span className="font-semibold">{logisticsScenarios[selected].perDay}</span>
                    </div>
                    <div className="flex justify-between border-t border-line pt-2">
                      <span className="text-muted">Total estimated cost</span>
                      <span className="font-bold text-primary text-[16px]">
                        {logisticsScenarios[selected].total}
                      </span>
                    </div>
                  </div>
                </>
              )}
              <div className="mt-auto text-[11px] text-faint border-t border-line pt-3">
                Prices may change. Recheck before booking.
              </div>
            </div>
            )}
          </div>
        ) : (
          <div className="hidden lg:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
            <button
              onClick={() => setPanelOpen(true)}
              aria-label="Expand travel plan"
              className="flex items-center justify-center w-7 h-7 border border-line rounded-md bg-surface text-primary cursor-pointer hover:border-primary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </button>
            <span className="text-[11px] font-semibold text-sub tracking-[0.09em]" style={{ writingMode: "vertical-rl" }}>
              TRAVEL PLAN
            </span>
          </div>
        )}
    </div>
  );
}
