"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioWaveform, ArrowRight, X, Zap, ShieldCheck, Users } from "lucide-react";

const examples = [
  "Check this result against ISO 16283",
  "Draft a Section 4 report",
  "Size a Dolby Atmos room",
  "Create a bill of materials",
];

const values = [
  {
    icon: Zap,
    title: "Speed",
    body: "Answers from your own reports and standards in seconds.",
  },
  {
    icon: ShieldCheck,
    title: "Confidence",
    body: "Every figure cites the clause, report or template behind it.",
  },
  {
    icon: Users,
    title: "Collaboration",
    body: "Consultant, builder and client read one project record.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [exampleIndex, setExampleIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [visionOpen, setVisionOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setExampleIndex((i) => (i + 1) % examples.length), 3200);
    return () => clearInterval(id);
  }, []);

  function submitPrompt() {
    if (!prompt.trim()) return;
    setChooserOpen(true);
  }

  function routeTo(workspace: "consult" | "build") {
    setChooserOpen(false);
    router.push(`/${workspace}/new`);
  }

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-hero text-white">
      <Image
        src="/images/smart-studio-mix-room.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(12,13,13,0.88) 0%, rgba(12,13,13,0.55) 45%, rgba(12,13,13,0.18) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <header className="flex items-center justify-between px-6 md:px-10 py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-[26px] h-[26px] bg-primary rounded-md text-white">
              <AudioWaveform size={15} strokeWidth={1.8} />
            </span>
            <span className="font-bold text-[16px] tracking-tight">Helmonic</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-[13px] font-medium text-white/85">
            <Link href="/consult" className="hover:text-white">Consult</Link>
            <Link href="/build" className="hover:text-white">Build</Link>
            <Link href="/socials/marketing" className="hover:text-white">Socials</Link>
            <button className="border border-white/30 rounded-md px-3.5 py-1.5 hover:border-white hover:text-white">
              Sign in
            </button>
          </nav>
        </header>

        <main className="flex-1 flex flex-col justify-center px-6 md:px-10 py-8">
          <div className="w-full max-w-[720px] flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="m-0 font-extrabold text-[36px] sm:text-[46px] leading-[1.08] tracking-tight text-balance">
                Where industry insiders shape acoustic excellence.
              </h1>
              <p className="m-0 text-[16px] leading-[1.6] text-white/80 max-w-[560px]">
                One workspace for standards interpretation, acoustic surveys, studio design and
                indicative build cost, with every figure traceable to its source.
              </p>
            </div>

            <div className="relative">
              <div className="flex items-center gap-3 bg-white/94 backdrop-blur rounded-md border border-white/40 px-4 py-3.5 shadow-lg">
                <AudioWaveform size={17} strokeWidth={1.8} className="text-primary shrink-0" />
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPrompt()}
                  placeholder={examples[exampleIndex]}
                  className="flex-1 min-w-0 outline-none text-[15px] text-ink placeholder:text-faint bg-transparent"
                />
                <button
                  onClick={submitPrompt}
                  className="shrink-0 flex items-center gap-1.5 rounded-md bg-primary text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-primary-hover"
                >
                  Try a prompt
                  <ArrowRight size={14} strokeWidth={2} />
                </button>
              </div>

              {chooserOpen && (
                <div className="absolute top-[calc(100%+10px)] left-0 right-0 sm:right-auto sm:w-[440px] bg-surface border border-line rounded-md shadow-xl p-4 flex flex-col gap-3 z-20 text-ink">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[14px]">
                      Where should Helbot use this prompt?
                    </span>
                    <button onClick={() => setChooserOpen(false)} className="text-muted hover:text-ink">
                      <X size={16} strokeWidth={1.8} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      onClick={() => routeTo("consult")}
                      className="text-left border border-line rounded-md p-3.5 hover:border-primary flex flex-col gap-1"
                    >
                      <span className="font-semibold text-[13px]">Consult · iAcoustics</span>
                      <span className="text-[12px] text-muted">
                        Standards, surveys and report drafting
                      </span>
                    </button>
                    <button
                      onClick={() => routeTo("build")}
                      className="text-left border border-line rounded-md p-3.5 hover:border-primary flex flex-col gap-1"
                    >
                      <span className="font-semibold text-[13px]">Build · Smart Studio</span>
                      <span className="text-[12px] text-muted">
                        Room design, specifications, BOM and indicative cost
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <div className="flex flex-col gap-1">
                <div className="w-10 h-px bg-primary" />
                <p className="m-0 text-[16px] italic leading-[1.5] max-w-[420px]">
                  &ldquo;Great rooms sound right the first time.&rdquo;
                  <span className="not-italic text-white/70"> – Jim Dunne</span>
                </p>
              </div>
              <button
                onClick={() => setVisionOpen(true)}
                className="border border-white/35 rounded-md px-3.5 py-2 text-[12px] font-semibold hover:border-white"
              >
                Founders&rsquo; Vision
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 pt-2 border-t border-white/15 mt-1">
              {values.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-start gap-2.5 max-w-[220px] pt-4">
                  <Icon size={16} strokeWidth={1.7} className="text-white/70 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-[13px]">{title}</span>
                    <span className="text-[12px] leading-[1.5] text-white/65">{body}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        <footer className="flex items-center justify-between px-6 md:px-10 py-4 text-[12px] text-white/60 border-t border-white/10">
          <span>Helmonic · iAcoustics × Smart Studio</span>
          <div className="flex items-center gap-5">
            <span className="hover:text-white cursor-pointer">Founder articles</span>
            <span className="hover:text-white cursor-pointer">Terms</span>
            <span className="hover:text-white cursor-pointer">Privacy</span>
          </div>
        </footer>
      </div>

      {visionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8">
          <div className="w-full max-w-[820px] max-h-[90vh] bg-surface text-ink rounded-md overflow-hidden flex flex-col sm:flex-row">
            <div className="relative w-full sm:w-[300px] h-[180px] sm:h-auto shrink-0 bg-hero">
              <Image
                src="/images/smart-studio-mix-room.jpg"
                alt="Jim Dunne, Founder"
                fill
                className="object-cover opacity-80"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(0deg, rgba(12,13,13,0.75) 0%, rgba(12,13,13,0.1) 60%)",
                }}
              />
              <div className="absolute bottom-4 left-4 text-white">
                <div className="font-semibold text-[15px]">Jim Dunne</div>
                <div className="text-[12px] text-white/75">Founder</div>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-3.5 p-6 md:p-7 overflow-auto">
              <h3 className="m-0 font-bold text-[20px] tracking-tight">Founders&rsquo; Vision</h3>
              <div className="w-[120px] h-[2px] bg-primary" />
              <p className="m-0 text-[14px] leading-[1.65] text-sub">
                Helmonic exists because two companies I built kept solving the same problem twice
                – iAcoustics interpreting a standard, Smart Studio applying it on site. Putting
                them in one workspace means a consultant&rsquo;s finding and a builder&rsquo;s
                spec are never more than one thread apart, and every answer carries the source it
                came from back to the client.
              </p>
              <p className="m-0 text-[14px] italic text-sub">
                &ldquo;Great rooms sound right the first time.&rdquo; – Jim Dunne
              </p>
              <button
                onClick={() => setVisionOpen(false)}
                className="mt-auto self-start border border-line rounded-md px-4 py-2 text-[13px] font-semibold text-sub hover:border-primary hover:text-primary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
