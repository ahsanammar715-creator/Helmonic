"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, X } from "lucide-react";
import TopBar from "@/components/TopBar";
import ChatComposer from "@/components/ChatComposer";
import {
  roomUseOptions,
  roomSubtypes,
  floorAreas,
  extraRooms,
  bomLines,
  costBreakdown,
  indicativeCostEur,
} from "@/lib/data";
import { useCurrency, formatCurrency, Currency } from "@/lib/currency";

export default function BuildNewPage() {
  const [currency, setCurrency] = useCurrency();
  const [complete, setComplete] = useState(false);
  const [roomUse, setRoomUse] = useState(roomUseOptions[0]);
  const [floorArea, setFloorArea] = useState(floorAreas[4]);
  const [rooms, setRooms] = useState(extraRooms[1]);
  const [areaOpen, setAreaOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState(false);

  function downloadCsv() {
    setExportOpen(false);
    setToast(true);
    setTimeout(() => setToast(false), 3500);
  }

  return (
    <div className="flex h-full min-w-0 relative">
      {toast && (
        <div className="absolute top-5 right-5 z-20 flex items-center gap-2 bg-surface border border-teal rounded-md shadow-lg px-4 py-3 text-[13px]">
          <Check size={16} strokeWidth={2} className="text-teal" />
          BOM generated · sent to jim@example.com
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          workspace="build"
          title="Build"
          subtitle={complete ? "Smart Studio · all four basics set" : "Smart Studio · new build"}
          mode="Studio template v4"
        />
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0 bg-canvas">
            <div className="flex-1 px-6 md:px-9 pt-6 flex flex-col gap-3.5 overflow-auto">
              {!complete ? (
                <>
                  <div className="max-w-[720px] flex flex-col gap-1.5">
                    <h3 className="m-0 font-bold text-[22px] tracking-tight">
                      Four basics and the spec writes itself.
                    </h3>
                    <p className="m-0 text-[14px] text-muted">
                      Enter a few basics · Helmonic fills in the Smart Studio spec so you only
                      override what is truly bespoke.
                    </p>
                  </div>

                  <div className="border border-line rounded-md bg-surface p-4 flex flex-col gap-2.5">
                    <p className="m-0 text-[14px]">What is the room for?</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {roomUseOptions.map((o) => (
                        <button
                          key={o}
                          onClick={() => setRoomUse(o)}
                          className={`flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-semibold ${
                            roomUse === o
                              ? "border border-primary text-primary bg-primary-tint-2"
                              : "border border-line text-sub hover:border-primary hover:text-primary"
                          }`}
                        >
                          {o}
                          {roomUse === o && <Check size={13} strokeWidth={1.8} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {roomUse === roomUseOptions[0] && (
                    <div className="text-right">
                      <span className="inline-block border border-line rounded-md bg-surface px-3.5 py-2.5 text-[14px]">
                        Post-production · {roomSubtypes[1]}
                      </span>
                    </div>
                  )}

                  <div className="border border-line rounded-md bg-surface p-4 flex flex-col gap-2.5">
                    <p className="m-0 text-[14px]">
                      How large is the floor, and are there rooms beyond the theatre?
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3.5 items-start">
                      <div className="flex-1 relative flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold text-faint">
                          SIZE OF THE ROOM
                        </span>
                        <button
                          onClick={() => setAreaOpen((o) => !o)}
                          className="border border-primary rounded-md px-3 py-2.5 text-[13px] flex items-center justify-between"
                        >
                          {floorArea}
                          <ChevronDown size={14} strokeWidth={1.8} className="text-faint" />
                        </button>
                        {areaOpen && (
                          <div className="absolute top-full left-0 right-0 mt-1.5 border border-line rounded-md bg-surface shadow-lg p-1.5 flex flex-col z-10">
                            {floorAreas.map((a) => (
                              <button
                                key={a}
                                onClick={() => {
                                  setFloorArea(a);
                                  setAreaOpen(false);
                                }}
                                className={`text-left px-2.5 py-2 rounded-md text-[13px] hover:bg-primary-tint-2 ${
                                  a === floorArea ? "text-primary font-semibold bg-primary-tint-2" : "text-sub"
                                }`}
                              >
                                {a}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold text-faint">
                          ADDITIONAL ROOMS
                        </span>
                        <div className="flex gap-2">
                          {extraRooms.map((r) => (
                            <button
                              key={r}
                              onClick={() => setRooms(r)}
                              className={`flex-1 text-center rounded-md px-2.5 py-2.5 text-[13px] ${
                                rooms === r
                                  ? "border border-primary text-primary bg-primary-tint-2 font-semibold"
                                  : "border border-line text-sub hover:border-primary hover:text-primary"
                              }`}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <span className="text-[12px] text-faint">
                          Machine room, VO booth or a second edit suite.
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-end">
                    <div className="border border-line rounded-md bg-surface px-3.5 py-2.5 text-[14px]">
                      {floorArea}, {rooms.toLowerCase()} extra rooms.
                    </div>
                  </div>
                  <div className="border border-line rounded-md bg-surface p-4.5 flex flex-col gap-3.5">
                    <p className="m-0 text-[14px] leading-[1.65]">
                      Spec is complete. Template SS-W12 walls on an SS-C3 raft, sized to{" "}
                      {floorArea} plus {rooms.toLowerCase()} extra rooms. Drawings and the bill of
                      materials are on the right.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {[
                        ["INTENDED USE", roomUse],
                        ["SUBTYPE", roomSubtypes[1]],
                        ["FLOOR AREA", floorArea],
                        ["ADDITIONAL ROOMS", rooms],
                      ].map(([label, value]) => (
                        <div key={label} className="border border-line rounded-md px-3 py-2.5 flex flex-col gap-0.5">
                          <span className="text-[10px] font-semibold tracking-[0.08em] text-faint">
                            {label}
                          </span>
                          <span className="flex items-center gap-2 text-[13px]">
                            {value}
                            <span className="ml-auto text-[12px] text-primary">Change</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="border border-line rounded-md p-3.5 bg-canvas text-[13px] leading-[1.6] text-sub">
                      <strong className="font-semibold text-ink">Heads-up:</strong> a Dolby ATMOS
                      theatre at this area needs 2.4 m clear height under the raft for overhead
                      speakers. The template assumes a 380 mm ceiling void, so confirm the
                      slab-to-slab dimension before the drawings are issued.
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3 relative">
                      <button className="rounded-md bg-primary text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-primary-hover">
                        Issue drawings
                      </button>
                      <div className="relative">
                        <button
                          onClick={() => setExportOpen((o) => !o)}
                          aria-expanded={exportOpen}
                          className="border border-primary rounded-md px-4 py-2.5 text-[13px] font-semibold text-primary bg-primary-tint"
                        >
                          Export BOM
                        </button>
                        {exportOpen && (
                          <div className="absolute top-[calc(100%+8px)] left-0 z-10 w-[360px] sm:w-[400px] bg-surface border border-line rounded-md shadow-lg overflow-hidden">
                            <div className="flex items-start justify-between gap-4 px-5 pt-4.5 pb-3.5 border-b border-line">
                              <div className="flex flex-col gap-1">
                                <h3 className="m-0 font-bold text-[16px] tracking-tight">
                                  Export bill of materials
                                </h3>
                                <span className="text-[12px] text-muted">
                                  CSV columns: Item · Qty · Unit – one row per line item.
                                </span>
                              </div>
                              <button onClick={() => setExportOpen(false)} className="text-muted hover:text-ink">
                                <X size={16} strokeWidth={1.8} />
                              </button>
                            </div>
                            <div className="px-5 py-4 flex flex-col gap-2">
                              <label className="flex items-center gap-3 border border-line rounded-md px-3.5 py-3 cursor-pointer">
                                <span className="w-3.5 h-3.5 rounded-full border border-line block" />
                                <span className="text-[13px]">PDF · formatted spec sheet</span>
                              </label>
                              <label className="flex items-center gap-3 border border-line rounded-md px-3.5 py-3 cursor-pointer">
                                <span className="w-3.5 h-3.5 rounded-full border border-line block" />
                                <span className="text-[13px]">CSV · line items only</span>
                              </label>
                              <label className="flex items-center gap-3 border border-primary rounded-md px-3.5 py-3 cursor-pointer bg-primary-tint">
                                <span className="w-3.5 h-3.5 rounded-full border-[5px] border-primary block" />
                                <span className="text-[13px] font-semibold">
                                  Send to email · jim@example.com
                                </span>
                              </label>
                            </div>
                            <div className="flex items-center gap-4 px-5 py-3.5 border-t border-line">
                              <span className="text-[12px] text-primary hover:underline cursor-pointer">
                                Open in Sheets
                              </span>
                              <button
                                onClick={downloadCsv}
                                className="ml-auto rounded-md bg-primary text-white px-4.5 py-2.5 text-[13px] font-semibold hover:bg-primary-hover"
                              >
                                Download CSV
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <Link href="/build/bom" className="ml-auto text-[12px] text-primary hover:underline">
                        View printable BOM
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>
            <ChatComposer
              placeholder={
                complete
                  ? "Ask for a change, or request a client-friendly summary…"
                  : "Answer here, or describe the room in your own words…"
              }
              helper="Costs are indicative, generated from the stored Smart Studio template. Ask to change any answer and the spec updates."
              onSend={() => setComplete(true)}
            />
          </div>

          <div className="hidden lg:flex w-[380px] shrink-0 border-l border-line bg-surface flex-col min-w-0">
            <div className="flex items-center justify-between px-5.5 py-4 border-b border-line">
              <span className="text-[11px] font-semibold text-muted tracking-[0.09em]">
                LIVE SPEC &amp; BILL OF MATERIALS
              </span>
              <span className="flex items-center gap-1.5">
                {(["EUR", "GBP", "USD"] as Currency[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCurrency(c)}
                    className={`rounded px-1.5 py-1 text-[10px] font-semibold ${
                      currency === c
                        ? "border border-primary text-primary"
                        : "border border-line text-muted hover:border-primary hover:text-primary"
                    }`}
                  >
                    {c === "EUR" ? "€ EUR" : c === "GBP" ? "£ GBP" : "$ USD"}
                  </button>
                ))}
              </span>
            </div>
            <div className="flex-1 px-5.5 py-5 flex flex-col gap-1.5 min-h-0 overflow-auto">
              {[
                ["Floor area", floorArea],
                ["Wall area", "96.8 m²"],
                ["Wall build-up", "SS-W12 · 92 mm"],
                ["Ceiling system", "SS-C3 isolated raft"],
                ["Target DnT,w", "62 dB"],
                ...(complete ? [["Additional rooms", rooms]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-line text-[13px]">
                  <span className="text-sub">{label}</span>
                  <span className="font-semibold">{value}</span>
                </div>
              ))}

              {!complete ? (
                <div className="mt-3.5 border border-line rounded-md p-3.5 text-[12px] leading-[1.55] text-sub bg-canvas">
                  Additional rooms not yet set, so the indicative cost covers the theatre only.
                </div>
              ) : (
                <div className="mt-3 border border-line rounded-md overflow-hidden">
                  <div className="grid grid-cols-[1.6fr_0.5fr_0.6fr] bg-primary-tint-2 text-[10px] font-semibold tracking-[0.06em] text-sub">
                    <div className="px-2.5 py-2">ITEM</div>
                    <div className="px-2.5 py-2 text-right">QTY</div>
                    <div className="px-2.5 py-2">UNIT</div>
                  </div>
                  {bomLines.map((l) => (
                    <div key={l.item} className="grid grid-cols-[1.6fr_0.5fr_0.6fr] border-t border-line text-[12px]">
                      <div className="px-2.5 py-2">{l.item}</div>
                      <div className="px-2.5 py-2 text-right">{l.qty}</div>
                      <div className="px-2.5 py-2 text-muted">{l.unit}</div>
                    </div>
                  ))}
                  <div className="border-t border-line px-2.5 py-2 text-[12px] text-primary bg-canvas">
                    28 more lines
                  </div>
                </div>
              )}

              <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3.5">
                {complete &&
                  costBreakdown.map((c) => (
                    <div key={c.label} className="flex items-center justify-between text-[12px] text-sub">
                      <span>{c.label}</span>
                      <span className="font-semibold">{formatCurrency(c.amountEur, currency)}</span>
                    </div>
                  ))}
                <div className="flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-[12px] text-muted">Indicative cost</span>
                  <span className="font-bold text-[18px] text-primary">
                    {formatCurrency(indicativeCostEur, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
