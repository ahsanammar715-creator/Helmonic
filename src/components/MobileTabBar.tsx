"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Wrench, Truck, TrendingUp } from "lucide-react";
import { WorkspaceKey } from "@/lib/data";

const items: { key: WorkspaceKey; label: string; href: string; icon: React.ElementType }[] = [
  { key: "consult", label: "Consult", href: "/consult", icon: MessageSquare },
  { key: "build", label: "Build", href: "/build", icon: Wrench },
  { key: "logistics", label: "Logistics", href: "/logistics", icon: Truck },
  { key: "growth", label: "Growth", href: "/growth/marketing", icon: TrendingUp },
];

function activeFromPath(pathname: string): WorkspaceKey | null {
  if (pathname.startsWith("/consult")) return "consult";
  if (pathname.startsWith("/build")) return "build";
  if (pathname.startsWith("/logistics")) return "logistics";
  if (pathname.startsWith("/growth")) return "growth";
  return null;
}

export default function MobileTabBar() {
  const pathname = usePathname();
  const active = activeFromPath(pathname);

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-line bg-surface">
      {items.map(({ key, label, href, icon: Icon }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={href}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] ${
              isActive ? "text-primary font-semibold" : "text-muted"
            }`}
          >
            <Icon size={18} strokeWidth={1.7} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
