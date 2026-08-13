"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import TopBar from "@/components/TopBar";

export default function GrowthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLeads = pathname.startsWith("/growth/leads");
  const isTenders = pathname.startsWith("/growth/tenders");

  return (
    <div className="flex flex-col h-full min-w-0">
      <TopBar workspace="growth" title="Growth" subtitle="Marketing and market intelligence · Helmonic" mode="Helmonic" />
      <div className="flex items-center gap-1 px-6 md:px-10 pt-4 border-b border-line overflow-x-auto">
        <Link
          href="/growth/marketing"
          className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            !isLeads && !isTenders ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Marketing
        </Link>
        <Link
          href="/growth/leads"
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            isLeads ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Lead Generation
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            SS
          </span>
        </Link>
        <Link
          href="/growth/tenders"
          className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            isTenders ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Tender Intelligence
          <span className="border border-line rounded px-1.5 py-0.5 text-[10px] font-semibold text-faint">
            iA
          </span>
        </Link>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
