"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, AlertTriangle } from "lucide-react";
import TopBar from "@/components/TopBar";
import ChatComposer from "@/components/ChatComposer";
import WaveDivider from "@/components/WaveDivider";
import { UserBubble, AssistantBubble } from "@/components/ChatBubble";
import WhatThisCreates from "@/components/WhatThisCreates";
import { siteTypes, surveyTypes, parsedRows } from "@/lib/data";

type Stage = "start" | "criteria" | "review";

export default function ConsultNewProjectPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("start");
  const [siteType, setSiteType] = useState(siteTypes[0]);
  const [surveyType, setSurveyType] = useState(surveyTypes[0].label);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          workspace="consult"
          title="Consult"
          subtitle={
            stage === "start"
              ? "iAcoustics · new project"
              : stage === "criteria"
              ? "iAcoustics · new project"
              : "iAcoustics · ready to create"
          }
          right={
            stage !== "start" && (
              <span className="flex items-center gap-2 border border-line rounded-md px-3 py-2 text-[12px] text-sub bg-canvas">
                <span className="w-1.5 h-1.5 rounded-full bg-teal" />
                Client criteria · Rw 45
                <span className="text-primary font-semibold">Edit</span>
              </span>
            )
          }
        />

        <div className="flex-1 flex flex-col min-h-0 bg-canvas">
          <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
            {stage === "start" && (
              <>
                <div className="max-w-[760px] flex flex-col gap-1.5">
                  <h3 className="m-0 font-bold text-[22px] md:text-[24px] tracking-tight">
                    Start by telling Helmonic what the job is.
                  </h3>
                  <div className="w-[110px]">
                    <WaveDivider color="var(--color-primary)" />
                  </div>
                  <p className="m-0 text-[14px] text-muted">
                    Drop measurement files, paste the client brief, or just describe the room.
                    Helmonic pulls out the project details as you go, and you can bind a standard
                    whenever you are ready.
                  </p>
                </div>

                <UserBubble>
                  Harrow Property Group, level 3 boardroom. Client wants Rw 45 between the
                  boardroom and the open office. We measured airborne on Tuesday, two receiving
                  positions are missing.
                </UserBubble>

                <AssistantBubble>
                  <p className="m-0 text-[14px] leading-[1.65]">
                    I have read both files: 12 of 14 positions, one-third octave, calibration
                    certificate current. Here is what I filled in for you – correct anything that
                    is wrong.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-faint">
                        PROJECT
                      </span>
                      <span className="text-[13px]">Level 3 boardroom · Rw verification</span>
                    </div>
                    <div className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-faint">
                        CLIENT · SITE
                      </span>
                      <span className="text-[13px]">
                        Harrow Property Group · commercial fit-out
                      </span>
                    </div>
                    <div className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold tracking-[0.08em] text-faint">
                        SURVEY
                      </span>
                      <span className="text-[13px]">
                        Airborne D<sub>nT,w</sub> · target 45
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
                    <span className="text-[13px] text-sub">
                      Bind a standards set so answers cite clauses?
                    </span>
                    <button
                      onClick={() => setStage("criteria")}
                      className="rounded-md bg-primary text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-primary-hover"
                    >
                      Pick standards
                    </button>
                    <button
                      onClick={() => setStage("criteria")}
                      className="border border-line rounded-md px-3.5 py-2 text-[12px] font-semibold text-sub hover:border-primary hover:text-primary"
                    >
                      Use client criteria instead
                    </button>
                    <button
                      onClick={() => setStage("criteria")}
                      className="text-[12px] text-primary hover:underline"
                    >
                      Decide later
                    </button>
                  </div>
                </AssistantBubble>
              </>
            )}

            {stage !== "start" && (
              <>
                <UserBubble>Use the client criteria – Rw 45, no separate standard.</UserBubble>
                <AssistantBubble>
                  <p className="m-0 text-[14px] leading-[1.65]">
                    Noted – Rw 45 as the client target. Two details I still need before I can
                    write method text:
                  </p>
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="w-[100px] shrink-0 text-[12px] font-semibold text-sub">
                        Site type
                      </span>
                      {siteTypes.slice(0, 3).map((t) => (
                        <button
                          key={t}
                          onClick={() => setSiteType(t)}
                          className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] ${
                            siteType === t
                              ? "border border-primary text-primary bg-primary-tint-2 font-semibold"
                              : "border border-line text-sub hover:border-primary hover:text-primary"
                          }`}
                        >
                          {t}
                          {siteType === t && <Check size={13} strokeWidth={1.8} />}
                        </button>
                      ))}
                      <span className="text-[12px] text-primary">3 more</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="w-[100px] shrink-0 text-[12px] font-semibold text-sub">
                        Survey type
                      </span>
                      {surveyTypes.map((s) => (
                        <button
                          key={s.label}
                          onClick={() => setSurveyType(s.label)}
                          className={`rounded-md px-3 py-2 text-[13px] ${
                            surveyType === s.label
                              ? "border border-primary text-primary bg-primary-tint-2 font-semibold"
                              : "border border-line text-sub hover:border-primary hover:text-primary"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </AssistantBubble>

                <div className="max-w-[900px] ml-[44px] border border-line rounded-md bg-surface overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line">
                    <span className="text-[11px] font-semibold text-muted tracking-[0.09em]">
                      PARSED FROM YOUR FILES · ONE-THIRD OCTAVE, dB
                    </span>
                    <span className="ml-auto text-[12px] text-primary">Open full table</span>
                  </div>
                  <div className="grid grid-cols-[1.6fr_repeat(5,0.8fr)] bg-primary-tint-2 text-[11px] font-semibold text-sub">
                    <div className="px-3.5 py-2.5">Position</div>
                    <div className="px-3 py-2.5">63</div>
                    <div className="px-3 py-2.5">125</div>
                    <div className="px-3 py-2.5">500</div>
                    <div className="px-3 py-2.5">2k</div>
                    <div className="px-3 py-2.5">
                      D<sub>nT,w</sub>
                    </div>
                  </div>
                  {parsedRows.map((r) => (
                    <div
                      key={r.pos}
                      className="grid grid-cols-[1.6fr_repeat(5,0.8fr)] border-t border-line-soft text-[13px]"
                    >
                      <div className="px-3.5 py-2.5">{r.pos}</div>
                      <div className="px-3 py-2.5 text-muted">{r.f63}</div>
                      <div className="px-3 py-2.5 text-muted">{r.f125}</div>
                      <div className="px-3 py-2.5 text-muted">{r.f500}</div>
                      <div className="px-3 py-2.5 text-muted">{r.f2k}</div>
                      <div className="px-3 py-2.5 text-primary font-semibold">{r.dntw}</div>
                    </div>
                  ))}
                  <button
                    onClick={() => setGapsOpen((o) => !o)}
                    aria-expanded={gapsOpen}
                    className="w-full flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] font-semibold text-sub bg-canvas hover:text-primary text-left"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                    <span className="flex-1">2 gap checks · 12 of 14 positions read</span>
                    <ChevronDown
                      size={14}
                      strokeWidth={1.8}
                      className={`text-faint transition-transform ${gapsOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {gapsOpen && (
                    <div className="px-4 py-3 text-[12px] text-sub border-t border-line-soft flex flex-col gap-1.5">
                      <span>P4 · receiving, south — interpolated from adjacent positions.</span>
                      <span>P5 · receiving, west — not captured in this export.</span>
                    </div>
                  )}
                </div>

                {stage === "review" && (
                  <>
                    <UserBubble>Commercial fit-out, airborne only. Draft the report.</UserBubble>
                    <AssistantBubble>
                      <p className="m-0 text-[14px] leading-[1.65]">
                        Here is where the project stands. Boardroom and meeting room 2 clear the
                        client target; impact is out of scope because it was not measured.
                      </p>
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-3 border border-line rounded-md p-3.5">
                          <Check size={18} strokeWidth={1.7} className="text-primary shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-semibold text-[14px]">
                              Targets met · 2 of 3 rooms
                            </span>
                            <span className="text-[13px] text-muted">
                              Boardroom D<sub>nT,w</sub> 46 against a target of 45. Meeting room 2
                              at 47.
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setChecksOpen((o) => !o)}
                          aria-expanded={checksOpen}
                          className="flex items-center gap-2.5 border border-line rounded-md p-3.5 text-left hover:border-primary"
                        >
                          <AlertTriangle size={18} strokeWidth={1.7} className="text-warning shrink-0" />
                          <span className="flex-1 font-semibold text-[14px]">
                            2 items flagged · out of scope, interpolated data
                          </span>
                          <span className="text-[12px] text-faint">Show detail</span>
                          <ChevronDown
                            size={15}
                            strokeWidth={1.8}
                            className={`text-faint transition-transform ${
                              checksOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                        {checksOpen && (
                          <div className="px-3.5 text-[12px] text-sub flex flex-col gap-1.5">
                            <span>Impact insulation was out of scope · not measured.</span>
                            <span>P4 south position interpolated · flagged for re-measurement.</span>
                          </div>
                        )}
                        <div className="flex gap-3 border border-line rounded-md p-3.5">
                          <Check size={18} strokeWidth={1.7} className="text-primary shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-semibold text-[14px]">Draft ready</span>
                            <span className="text-[13px] text-muted">
                              Section 4 compliance report, 11 pages, tables and figures generated
                              from the parsed data.
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
                        <button
                          onClick={() => router.push("/consult/report")}
                          className="rounded-md bg-primary text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-primary-hover"
                        >
                          Create project &amp; draft report
                        </button>
                        <button
                          onClick={() => router.push("/consult")}
                          className="border border-line rounded-md px-4 py-2.5 text-[13px] font-semibold text-sub hover:border-primary hover:text-primary"
                        >
                          Create project only
                        </button>
                        <button
                          onClick={() => router.push("/consult/report")}
                          className="ml-auto text-[12px] text-primary hover:underline"
                        >
                          Preview the draft
                        </button>
                      </div>
                    </AssistantBubble>
                  </>
                )}
              </>
            )}
          </div>

          <ChatComposer
            placeholder={
              stage === "start"
                ? "Add notes, drop more files, or ask a question about this project…"
                : stage === "criteria"
                ? "Answer, or ask why a position was flagged…"
                : "Ask for a change before we create it…"
            }
            helper="Everything stays editable. Ask Helmonic to change a target, swap a standard, or re-read a file at any point."
            onSend={() => stage === "criteria" && setStage("review")}
          />
        </div>
      </div>
      {stage !== "start" && (
        <WhatThisCreates
          footer={
            stage === "review"
              ? "Creating the project also opens the Section 4 draft in Consult, with every figure traceable to a source."
              : "Nothing is locked in. Criteria, targets and files stay editable in this thread after the project is created."
          }
        />
      )}
    </div>
  );
}
