"use client";

import { useState } from "react";
import { ChevronRight, ChevronLeft, Check, History, Copy } from "lucide-react";
import ChatComposer from "@/components/ChatComposer";
import { UserBubble, AssistantBubble } from "@/components/ChatBubble";
import { marketingSuggestions, draftVersions } from "@/lib/data";

const DRAFT_BASE =
  "Level 2 boardroom, checked. Measured Rw 46 against a client target of 45 – first time, no rework. That is what a room-in-room build from Smart Studio gets you.";

export default function MarketingPage() {
  const [started, setStarted] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [approved, setApproved] = useState(false);
  const [applied, setApplied] = useState<string[]>([]);

  function applySuggestion(s: string) {
    if (!applied.includes(s)) setApplied((a) => [...a, s]);
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0 bg-canvas">
        <div className="flex-1 px-6 md:px-10 pt-6 flex flex-col gap-4 overflow-auto">
          {!started ? (
            <div className="max-w-[560px] flex flex-col gap-3">
              <h3 className="m-0 font-bold text-[22px] tracking-tight">
                Turn a project into a draft.
              </h3>
              <p className="m-0 text-[14px] text-muted">
                Tell Helmonic what to make. It only uses approved project facts, reports and
                images, and flags anything generated so it never reads as verified.
              </p>
              <button
                onClick={() => setStarted(true)}
                className="text-left border border-line rounded-md px-3.5 py-3 text-[13px] hover:border-primary hover:text-primary"
              >
                Create a LinkedIn post about the Level 2 boardroom project.
              </button>
            </div>
          ) : (
            <>
              <UserBubble>Create a LinkedIn post about the Level 2 boardroom project.</UserBubble>
              <AssistantBubble>
                <p className="m-0 text-[14px] leading-[1.65]">
                  I pulled the measured Rw 46 result and client target from the project record.
                  Draft is in the panel – a few things to confirm: is the client name approved for
                  publication, and should I keep the measured value?
                </p>
                <div className="flex flex-wrap gap-2">
                  {marketingSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => applySuggestion(s)}
                      className={`border rounded-md px-3 py-1.5 text-[12px] ${
                        applied.includes(s)
                          ? "border-teal text-teal bg-teal-tint"
                          : "border-line text-sub hover:border-primary hover:text-primary"
                      }`}
                    >
                      {applied.includes(s) && <Check size={11} strokeWidth={2} className="inline mr-1 -mt-0.5" />}
                      {s}
                    </button>
                  ))}
                </div>
              </AssistantBubble>
            </>
          )}
        </div>
        <ChatComposer
          placeholder={started ? "Ask Helmonic to refine the draft…" : "Describe what you want to create…"}
          helper="Verified project facts, approved quotations and generated language are shown separately in the draft."
          onSend={() => setStarted(true)}
        />
      </div>

      {panelOpen ? (
        <div className="hidden md:flex w-full max-w-[440px] shrink-0 border-l border-line bg-surface flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="flex items-center justify-center w-6 h-6 border border-line rounded-md bg-surface text-sub cursor-pointer hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                aria-label="Collapse drafts panel"
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
              <span className="text-[11px] font-semibold tracking-[0.09em] text-muted">DRAFTS</span>
            </span>
            <button
              onClick={() => setShowVersions((v) => !v)}
              className="flex items-center gap-1.5 text-[12px] text-sub hover:text-primary"
            >
              <History size={13} strokeWidth={1.8} />
              History
            </button>
          </div>

          {showVersions ? (
            <div className="flex-1 px-5 py-4 flex flex-col gap-2 overflow-auto">
              {draftVersions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setShowVersions(false)}
                  className="text-left border border-line rounded-md p-3 hover:border-primary flex flex-col gap-0.5"
                >
                  <span className="text-[13px] font-semibold">{v.version}</span>
                  <span className="text-[12px] text-muted">{v.note}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1 px-5 py-4 flex flex-col gap-3.5 overflow-auto">
              <div className="flex items-center gap-2">
                <span className="border border-line rounded px-2 py-0.5 text-[11px] font-semibold text-sub">
                  LinkedIn post
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    approved ? "bg-teal-tint text-teal" : "bg-primary-tint-2 text-sub"
                  }`}
                >
                  {approved ? "Approved" : started ? "Drafting" : "Needs information"}
                </span>
              </div>
              <div className="border border-line rounded-md bg-canvas p-4 text-[13px] leading-[1.6] flex flex-col gap-2.5 min-h-[160px]">
                {started ? (
                  <>
                    <p className="m-0">{DRAFT_BASE}</p>
                    {applied.includes("Keep the measured result.") && (
                      <p className="m-0 text-primary text-[12px]">
                        ↳ Measured Rw 46 (verified) retained per your note.
                      </p>
                    )}
                    {applied.includes("Shorten it for LinkedIn.") && (
                      <p className="m-0 text-faint text-[12px] italic">Shortened to fit a LinkedIn post.</p>
                    )}
                  </>
                ) : (
                  <span className="text-faint">Start a conversation to see a draft here.</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
                <span className="border border-line rounded px-2 py-1">Verified fact</span>
                <span className="border border-line rounded px-2 py-1">Approved quotation</span>
                <span className="border border-line rounded px-2 py-1">Generated language</span>
              </div>
              <div className="flex items-center gap-2 mt-auto border-t border-line pt-3">
                <button className="flex items-center gap-1.5 border border-line rounded-md px-3 py-2 text-[12px] text-sub hover:border-primary hover:text-primary">
                  <Copy size={13} strokeWidth={1.8} />
                  Copy
                </button>
                <button
                  disabled={!started}
                  onClick={() => setApproved(true)}
                  className="ml-auto rounded-md bg-primary text-white px-3.5 py-2 text-[12px] font-semibold hover:bg-primary-hover disabled:opacity-40"
                >
                  Approve draft
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="hidden md:flex w-11 shrink-0 border-l border-line bg-surface flex-col items-center gap-3.5 py-3.5">
          <button
            onClick={() => setPanelOpen(true)}
            aria-label="Expand drafts panel"
            className="flex items-center justify-center w-7 h-7 border border-line rounded-md bg-surface text-primary cursor-pointer hover:border-primary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          >
            <ChevronLeft size={14} strokeWidth={1.8} />
          </button>
          <span className="text-[11px] font-semibold text-sub tracking-[0.09em]" style={{ writingMode: "vertical-rl" }}>
            DRAFTS
          </span>
        </div>
      )}
    </div>
  );
}
