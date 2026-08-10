import { Info, MessageSquare, Wrench } from "lucide-react";
import { WorkspaceKey } from "@/lib/data";

export default function TopBar({
  workspace,
  title,
  subtitle,
  mode,
  right,
}: {
  workspace: WorkspaceKey;
  title: string;
  subtitle: string;
  mode?: string;
  right?: React.ReactNode;
}) {
  const isBuild = workspace === "build";
  const accent = isBuild ? "var(--color-teal)" : "var(--color-primary)";
  const Icon = isBuild ? Wrench : MessageSquare;

  return (
    <div
      className="flex items-center justify-between gap-5 px-6 md:px-10 py-5 border-b border-line"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-md"
          style={{
            background: isBuild ? "var(--color-teal-tint)" : "var(--color-primary-tint)",
            color: accent,
          }}
        >
          <Icon size={15} strokeWidth={1.7} />
        </span>
        <h2 className="m-0 font-bold text-[22px] tracking-tight">{title}</h2>
        <Info size={16} strokeWidth={1.6} className="text-muted hidden sm:block" />
        <span className="text-[13px] text-muted truncate hidden sm:inline">{subtitle}</span>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {right}
        {mode && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted whitespace-nowrap">
            <Info size={14} strokeWidth={1.6} />
            {mode}
          </span>
        )}
      </div>
    </div>
  );
}
