"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import TopBar from "@/components/TopBar";

export default function SocialsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLeads = pathname.startsWith("/socials/leads");
  const isTenders = pathname.startsWith("/socials/tenders");

  return (
    <div className="flex flex-col h-full min-w-0">
      <TopBar workspace="socials" title="Socials" subtitle="Marketing and market intelligence · Helmonic" mode="Helmonic" />
      <div className="flex items-center gap-1 px-6 md:px-10 pt-4 border-b border-line overflow-x-auto">
        <Link
          href="/socials/marketing"
          className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            !isLeads && !isTenders ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Marketing
        </Link>
        <Link
          href="/socials/leads"
          className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            isLeads ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Lead Generation
        </Link>
        <Link
          href="/socials/tenders"
          className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px ${
            isTenders ? "border-violet text-violet" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Tender Intelligence
        </Link>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
