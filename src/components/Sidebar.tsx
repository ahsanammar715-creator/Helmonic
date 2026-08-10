"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioWaveform, Settings } from "lucide-react";
import { workspaces, recentThreads, founder, WorkspaceKey } from "@/lib/data";

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

  return (
    <nav className="hidden md:flex w-[280px] shrink-0 border-r border-line bg-surface flex-col justify-between px-5 py-6">
      <div className="flex flex-col gap-7">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-[26px] h-[26px] bg-primary rounded-md text-white">
            <AudioWaveform size={15} strokeWidth={1.8} />
          </span>
          <span className="font-bold text-[16px] tracking-tight">Helmonic</span>
        </Link>

        <div className="flex flex-col gap-2.5">
          <div className="text-[11px] font-semibold text-muted tracking-[0.09em] pl-2.5">
            WORKSPACES
          </div>
          <div className="flex flex-col gap-0.5">
            {workspaces.map((w) => {
              const isActive = w.key === active;
              return (
                <Link
                  key={w.key}
                  href={w.href}
                  className={`flex items-center gap-2.5 px-2.5 py-2.5 rounded-md ${
                    isActive
                      ? "bg-primary-tint-2 font-semibold text-primary"
                      : "text-sub hover:bg-primary-tint-2"
                  }`}
                >
                  <span
                    className="w-[3px] h-[18px] rounded-sm"
                    style={{ background: isActive ? "#1763FF" : "transparent" }}
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
          <Settings size={18} strokeWidth={1.6} className="text-muted hover:text-primary" />
        </div>
      </div>
    </nav>
  );
}
