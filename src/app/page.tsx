"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, X, Zap, ShieldCheck, Users, ChevronDown } from "lucide-react";
import EqualizerIcon from "@/components/EqualizerIcon";

const examples = [
  "Check this result against ISO 16283",
  "Draft a Section 4 report",
  "Size a Dolby Atmos room",
  "Create a bill of materials",
];

const founderArticles = [
  {
    title: "Acoustics is the art of shaping calm",
    meta: "Jim Dunne · Founder's notes",
  },
  {
    title: "Inside Smart Studio's room-in-room method",
    meta: "Jim Dunne · Founder's notes",
  },
  {
    title: "What consultants get wrong about compliance",
    meta: "Jim Dunne · Founder's notes",
  },
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
  const [articlesOpen, setArticlesOpen] = useState(false);
  const [openArticle, setOpenArticle] = useState<number | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const articlesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!articlesOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (articlesRef.current && !articlesRef.current.contains(e.target as Node)) {
        setArticlesOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [articlesOpen]);

  useEffect(() => {
    const id = setInterval(() => setExampleIndex((i) => (i + 1) % examples.length), 3200);
    return () => clearInterval(id);
  }, []);

  function submitPrompt() {
    if (!prompt.trim()) setPrompt(examples[exampleIndex]);
    setChooserOpen(true);
  }

  function routeTo(workspace: "consult" | "build") {
    setChooserOpen(false);
    router.push(`/${workspace}/new`);
  }

  return (
    <div className="theme-locked-light relative min-h-dvh w-full overflow-hidden bg-hero text-white">
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
              <EqualizerIcon size={14} />
            </span>
            <span className="font-bold text-[16px] tracking-tight">Helmonic</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-[13px] font-medium">
            <Link href="/consult" className="text-white/85 hover:text-white">Consult</Link>
            <Link href="/build" className="text-white/85 hover:text-white">Build</Link>
            <Link href="/logistics" className="text-white/85 hover:text-white">Logistics</Link>
            <Link href="/socials/marketing" className="text-white/85 hover:text-white">Socials</Link>
            <button
              onClick={() => setSignInOpen(true)}
              className="border border-white/30 rounded-md px-3.5 py-1.5 hover:border-white hover:text-white"
            >
              Sign in
            </button>
          </nav>
        </header>

        <main className="flex-1 flex flex-col justify-center px-6 md:px-10 py-10">
          <div className="w-full max-w-[780px] flex flex-col gap-7">
            <div className="flex flex-col gap-4">
              <span className="self-start flex items-center gap-2 border border-white/25 rounded-full pl-3 pr-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
                <span className="w-1.5 h-1.5 rounded-full bg-teal shrink-0" />
                Powered by iAcoustics × Smart Studio
              </span>
              <h1 className="m-0 font-extrabold text-[36px] sm:text-[48px] leading-[1.08] tracking-tight text-balance">
                Where industry insiders shape acoustic excellence.
              </h1>
              <p className="m-0 text-[16px] leading-[1.6] text-white/80 max-w-[600px]">
                One workspace for standards interpretation, acoustic surveys, studio design and
                indicative build cost, with every figure traceable to its source.
              </p>
            </div>

            <div className="relative">
              <div className="flex items-center gap-3 bg-white/94 backdrop-blur rounded-md border border-white/40 px-4 py-3.5 shadow-lg">
                <EqualizerIcon size={17} className="text-primary" />
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
                      Where should Helmonic use this prompt?
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              {values.map(({ icon: Icon, title, body }) => (
                <div
                  key={title}
                  className="flex items-start gap-3 border border-white/15 bg-white/[0.04] backdrop-blur-sm rounded-md p-4"
                >
                  <span className="flex items-center justify-center w-8 h-8 rounded-md bg-teal/15 text-teal shrink-0">
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
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
            <div ref={articlesRef} className="relative">
              <button
                onClick={() => setArticlesOpen((o) => !o)}
                aria-expanded={articlesOpen}
                className="flex items-center gap-1 hover:text-white cursor-pointer"
              >
                Founder articles
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`transition-transform ${articlesOpen ? "rotate-180" : ""}`}
                />
              </button>
              {articlesOpen && (
                <div className="absolute bottom-[calc(100%+10px)] right-0 w-[280px] bg-surface text-ink border border-line rounded-md shadow-xl overflow-hidden z-20">
                  {founderArticles.map((a, i) => (
                    <button
                      key={a.title}
                      onClick={() => {
                        setOpenArticle(i);
                        setArticlesOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-3 border-b border-line last:border-b-0 hover:bg-canvas flex flex-col gap-0.5"
                    >
                      <span className="text-[13px] font-semibold leading-snug">{a.title}</span>
                      <span className="text-[11px] text-faint">{a.meta}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="hover:text-white cursor-pointer">Terms</span>
            <span className="hover:text-white cursor-pointer">Privacy</span>
          </div>
        </footer>
      </div>

      {visionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8">
          <div className="w-full max-w-[820px] max-h-[90vh] bg-surface text-ink rounded-md overflow-hidden flex flex-col sm:flex-row">
            <div className="relative w-full sm:w-[300px] h-[220px] sm:h-auto shrink-0 bg-hero">
              <Image
                src="/images/jim-dunne.png"
                alt="Jim Dunne, Founder"
                fill
                className="object-cover"
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(0deg, rgba(12,13,13,0.75) 0%, rgba(12,13,13,0.05) 55%)",
                }}
              />
              <div className="absolute bottom-4 left-4 text-white">
                <div className="font-semibold text-[15px]">Jim Dunne</div>
                <div className="text-[12px] text-white/75">Founder</div>
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-3.5 p-6 md:p-7 overflow-auto">
              <h3 className="m-0 font-bold text-[20px] leading-tight tracking-tight">
                Thirty years of rooms, in one place your team can actually use.
              </h3>
              <div className="w-[120px] h-[2px] bg-primary" />
              <p className="m-0 text-[14px] leading-[1.65] text-sub">
                Helmonic exists because good acoustic work is still passed around as folklore, a
                spreadsheet here, a decade-old report there. We wanted the insider knowledge that
                shapes great rooms available the moment a decision gets made, not weeks later.
                iAcoustics brings the measurement discipline. Smart Studio brings the delivery
                craft. Together they give consultants, builders and clients one source of truth,
                cited and auditable, so every room sounds right the first time.
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

      {openArticle !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8">
          <div className="w-full max-w-[560px] max-h-[90vh] bg-surface text-ink rounded-md overflow-hidden flex flex-col p-6 md:p-7 gap-3.5">
            <div className="flex items-start justify-between gap-4">
              <span className="text-[11px] font-semibold text-faint tracking-[0.08em]">
                {founderArticles[openArticle].meta.toUpperCase()}
              </span>
              <button
                onClick={() => setOpenArticle(null)}
                aria-label="Close article"
                className="text-muted hover:text-ink shrink-0"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>
            <h3 className="m-0 font-bold text-[22px] leading-tight tracking-tight">
              {founderArticles[openArticle].title}
            </h3>
            <div className="w-[80px] h-[2px] bg-primary" />
            <p className="m-0 text-[14px] leading-[1.65] text-sub overflow-auto">
              This article is a placeholder ­– the full piece isn&rsquo;t published in this demo
              yet. When it is, it will appear here and be reachable from this same link.
            </p>
            <button
              onClick={() => setOpenArticle(null)}
              className="mt-1 self-start border border-line rounded-md px-4 py-2 text-[13px] font-semibold text-sub hover:border-primary hover:text-primary"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {signInOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8">
          <div className="w-full max-w-[400px] bg-surface text-ink rounded-md overflow-hidden p-6 md:p-7 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="m-0 font-bold text-[20px] tracking-tight">Sign in to Helmonic</h3>
                <p className="m-0 text-[13px] leading-[1.5] text-muted">
                  Your projects, standards and drafts, right where you left them.
                </p>
              </div>
              <button
                onClick={() => setSignInOpen(false)}
                aria-label="Close sign-in"
                className="text-muted hover:text-ink shrink-0"
              >
                <X size={18} strokeWidth={1.8} />
              </button>
            </div>

            <form
              className="flex flex-col gap-3.5"
              onSubmit={(e) => {
                e.preventDefault();
                setSignInOpen(false);
              }}
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-sub">Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  className="border border-line rounded-md px-3.5 py-2.5 text-[14px] outline-none focus:border-primary"
                  placeholder="you@iacoustics.com"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-sub">Password</span>
                  <button type="button" className="text-[12px] text-primary hover:underline">
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  autoComplete="current-password"
                  className="border border-line rounded-md px-3.5 py-2.5 text-[14px] outline-none focus:border-primary"
                  placeholder="••••••••"
                />
              </label>
              <label className="flex items-center gap-2 text-[13px] text-sub">
                <input type="checkbox" className="w-4 h-4 accent-[#1763FF]" />
                Stay signed in on this device
              </label>
              <button
                type="submit"
                className="rounded-md bg-primary text-white px-4 py-2.5 text-[14px] font-semibold hover:bg-primary-hover"
              >
                Sign in
              </button>
            </form>

            <div className="flex items-center gap-3 text-[11px] text-faint">
              <span className="flex-1 h-px bg-line" />
              OR
              <span className="flex-1 h-px bg-line" />
            </div>

            <button
              onClick={() => setSignInOpen(false)}
              className="flex items-center justify-center gap-2.5 border border-line rounded-md px-4 py-2.5 text-[14px] font-semibold text-sub hover:border-primary hover:text-primary"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4c-7.6 0-14.1 4.3-17.4 10.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.3 0 10.1-2 13.7-5.4l-6.3-5.3C29.4 35 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.8 39.6 16.4 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.5l6.3 5.3C40.9 36.6 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"
                />
              </svg>
              Continue with Google
            </button>

            <p className="m-0 text-center text-[12px] text-muted">
              New to Helmonic?{" "}
              <button type="button" className="text-primary hover:underline font-semibold">
                Request access
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
