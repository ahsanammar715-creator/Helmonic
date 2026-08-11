"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { workspaces, recentThreads, founder, WorkspaceKey } from "@/lib/data";
import { workspaceTheme } from "@/lib/workspaceTheme";
import SettingsPanel from "./SettingsPanel";
import HelmonicMark from "./HelmonicMark";

function activeFromPath(pathname: string): WorkspaceKey | null {
  if (pathname.startsWith("/consult")) return "consult";
  if (pathname.startsWith("/build")) return "build";
  if (pathname.startsWith("/logistics")) return "logistics";
  if (pathname.startsWith("/socials")) return "socials";
  return null;
}

export default function Sidebar() {
  const pathname = usePathname();
  const active = activeFromPath(pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <nav className="hidden md:flex w-[280px] shrink-0 border-r border-line bg-surface flex-col justify-between px-5 py-6">
      <div className="flex flex-col gap-7">
        <Link href="/" className="flex items-center gap-2.5">
          <HelmonicMark />
          <span className="font-semibold text-[16px] tracking-tight">Helmonic</span>
        </Link>

        <div className="flex flex-col gap-2.5">
          <div className="text-[11px] font-semibold text-muted tracking-[0.09em] pl-2.5">
            WORKSPACES
          </div>
          <div className="flex flex-col gap-0.5">
            {workspaces.map((w) => {
              const isActive = w.key === active;
              const { accent, tint } = workspaceTheme[w.key];
              return (
                <Link
                  key={w.key}
                  href={w.href}
                  style={{ "--wa": accent, "--wt": tint } as React.CSSProperties}
                  className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-md transition-colors ${
                    isActive
                      ? "bg-[var(--wt)] font-semibold text-[var(--wa)]"
                      : "text-sub hover:bg-[var(--wt)] hover:text-[var(--wa)]"
                  }`}
                >
                  <span
                    className={`w-[3px] h-[18px] rounded-sm transition-colors ${
                      isActive ? "bg-[var(--wa)]" : "bg-transparent"
                    }`}
                  />
                  <span className="flex-1">{w.label}</span>
                  {w.badge && (
                    <span className="w-6 h-6 rounded-md bg-line text-ink flex items-center justify-center text-[10px] font-medium opacity-50">
                      {w.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="text-[11px] font-semibold text-muted tracking-[0.09em] pl-2.5">
            RECENT
          </div>
          <div className="flex flex-col gap-0.5 text-sub text-[14px]">
            {recentThreads.map((t) => (
              <div
                key={t}
                className="px-2.5 py-2 rounded-md truncate hover:bg-primary-tint-2 cursor-pointer"
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5 border-t border-line pt-3.5 text-[12px]">
          <div className="flex justify-between">
            <span className="font-semibold">iAcoustics</span>
            <span className="text-muted">consultancy</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Smart Studio</span>
            <span className="text-muted">design-build</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-primary-tint-2 border border-line text-sub flex items-center justify-center text-[12px] font-semibold">
            JD
          </span>
          <div className="flex-1 flex flex-col">
            <span className="text-[13px]">{founder.name}</span>
            <span className="text-[11px] text-faint">{founder.role}</span>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              aria-expanded={settingsOpen}
              aria-label="Settings"
              className="text-muted hover:text-primary"
            >
              <Settings size={18} strokeWidth={1.6} />
            </button>
            {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
          </div>
        </div>
      </div>
    </nav>
  );
}
