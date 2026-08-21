"use client";

import Link from "next/link";
import { FileText, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { AssistantBubble, UserBubble } from "@/components/ChatBubble";
import ChatComposer from "@/components/ChatComposer";
import SourcesPanel from "@/components/SourcesPanel";
import TopBar from "@/components/TopBar";
import WaveDivider from "@/components/WaveDivider";
import type {
  ConsultCitation,
  ConsultErrorResponse,
  ConsultQueryResponse,
} from "@/lib/consult/types";

type Exchange = {
  id: string;
  question: string;
  answer?: string | null;
  error?: string;
  mode?: ConsultQueryResponse["mode"];
  citations: ConsultCitation[];
};

const suggestedQuestions = [
  "Check a criterion against the source documents",
  "Summarise the measurement requirements",
  "What does the evidence say about sound insulation?",
];

function modeLabel(mode: ConsultQueryResponse["mode"] | undefined) {
  if (mode === "generated") return "Grounded answer";
  if (mode === "retrieval-only") return "Retrieval verified";
  if (mode === "no-evidence") return "Insufficient evidence";
  if (mode === "not-configured") return "Runtime not configured";
  return undefined;
}

function modeCopy(mode: ConsultQueryResponse["mode"] | undefined) {
  if (mode === "retrieval-only") {
    return "Evidence found — no generated summary in this build. Open Sources to review the retrieved passages.";
  }
  if (mode === "no-evidence") {
    return "Insufficient permitted evidence in the permitted Helmonic sources.";
  }
  if (mode === "not-configured") {
    return "The Azure Consult runtime is not configured in this deployment. No Azure service was contacted.";
  }
  return undefined;
}

export default function ConsultWorkspace() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pending, setPending] = useState(false);
  const latestSources = exchanges.at(-1)?.citations ?? [];

  async function ask(question: string) {
    if (pending) return;

    const id = crypto.randomUUID();
    setPending(true);
    setExchanges((current) => [...current, { id, question, citations: [] }]);

    try {
      const response = await fetch("/api/consult/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = (await response.json()) as ConsultQueryResponse | ConsultErrorResponse;

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "The Consult request failed.");
      }

      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                answer: payload.answer,
                mode: payload.mode,
                citations: payload.citations,
              }
            : exchange,
        ),
      );
    } catch (error) {
      setExchanges((current) =>
        current.map((exchange) =>
          exchange.id === id
            ? {
                ...exchange,
                error:
                  error instanceof Error
                    ? error.message
                    : "Helmonic could not complete the request.",
              }
            : exchange,
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          workspace="consult"
          title="Consult"
          subtitle="Five-document Phase 1A knowledge set · iAcoustics"
          mode="Standards mode on"
        />

        <div className="flex-1 min-h-0 overflow-auto bg-canvas">
          {exchanges.length === 0 ? (
            <div className="min-h-full flex items-center justify-center p-8 md:p-10">
              <div className="w-full max-w-[640px] border border-line rounded-md bg-surface p-7 md:p-9 flex flex-col gap-5.5 items-start">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-primary-tint text-primary">
                  <ShieldCheck size={19} strokeWidth={1.6} />
                </span>
                <div className="flex flex-col gap-2.5 w-full">
                  <h1 className="m-0 font-bold text-[28px] md:text-[32px] leading-tight tracking-tight">
                    What do you need to know?
                  </h1>
                  <div className="w-[120px]">
                    <WaveDivider color="var(--color-primary)" />
                  </div>
                  <p className="m-0 text-[15px] leading-[1.6] text-muted max-w-[520px]">
                    Ask a question against the controlled Phase 1A document set. Helmonic only
                    returns source evidence the server retrieved, with the page or section when
                    available.
                  </p>
                </div>

                <div className="flex flex-col gap-2 w-full">
                  {suggestedQuestions.map((question, index) => {
                    const Icon = index === 0 ? Search : FileText;
                    return (
                      <button
                        key={question}
                        type="button"
                        onClick={() => ask(question)}
                        disabled={pending}
                        className="flex items-center gap-2.5 px-3.5 py-3 border border-line rounded-md text-[15px] text-left hover:border-primary hover:text-primary disabled:opacity-45 disabled:pointer-events-none"
                      >
                        <Icon size={17} strokeWidth={1.6} />
                        {question}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/consult/new"
                    className="rounded-md bg-primary text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-primary-hover"
                  >
                    New project
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-6 md:px-10 py-6 flex flex-col gap-4">
              {exchanges.map((exchange) => (
                <div key={exchange.id} className="contents">
                  <UserBubble>{exchange.question}</UserBubble>
                  <AssistantBubble>
                    {exchange.mode === undefined && !exchange.error ? (
                      <div className="flex items-center gap-2 text-[13px] text-muted" role="status">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        Retrieving source evidence…
                      </div>
                    ) : exchange.error ? (
                      <div className="flex flex-col gap-2">
                        <p className="m-0 text-[14px] leading-[1.65] text-warning">
                          {exchange.error}
                        </p>
                        <button
                          type="button"
                          onClick={() => ask(exchange.question)}
                          className="self-start text-[12px] font-semibold text-primary hover:underline"
                        >
                          Retry this question
                        </button>
                      </div>
                    ) : exchange.mode !== "generated" ? (
                      <>
                        {modeLabel(exchange.mode) && (
                          <span className="self-start rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-semibold text-primary">
                            {modeLabel(exchange.mode)}
                          </span>
                        )}
                        <p className="m-0 text-[14px] leading-[1.7]">
                          {modeCopy(exchange.mode)}
                        </p>
                        {exchange.citations.length > 0 && (
                          <div className="border-t border-line pt-3 text-[12px] text-muted">
                            {exchange.citations.length} server-verified source passage
                            {exchange.citations.length === 1 ? "" : "s"} retrieved. Open Sources
                            for the evidence.
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {modeLabel(exchange.mode) && (
                          <span className="self-start rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-semibold text-primary">
                            {modeLabel(exchange.mode)}
                          </span>
                        )}
                        <p className="m-0 whitespace-pre-wrap text-[14px] leading-[1.7]">
                          {exchange.answer}
                        </p>
                        {exchange.citations.length > 0 && (
                          <div className="border-t border-line pt-3 text-[12px] text-muted">
                            {exchange.citations.length} server-verified source passage
                            {exchange.citations.length === 1 ? "" : "s"} retrieved. Open Sources
                            for the evidence.
                          </div>
                        )}
                      </>
                    )}
                  </AssistantBubble>
                </div>
              ))}
            </div>
          )}
        </div>

        <ChatComposer
          inputId="consult-question"
          placeholder="Ask Helmonic about the five source documents…"
          helper="Phase 1A demo: fixed iAcoustics profile, controlled documents, server-authoritative citations."
          onSend={ask}
          disabled={pending}
          showAttach={false}
        />
      </div>

      <SourcesPanel sources={latestSources} allowAdd={false} />
    </div>
  );
}
