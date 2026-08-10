import Link from "next/link";
import { Search, FileText, LineChart } from "lucide-react";
import TopBar from "@/components/TopBar";
import SourcesPanel from "@/components/SourcesPanel";
import ChatComposer from "@/components/ChatComposer";
import WaveDivider from "@/components/WaveDivider";
import { WorkspaceKey } from "@/lib/data";
import { workspaceTheme } from "@/lib/workspaceTheme";

export default function EmptyStateShell({
  workspace,
  title,
  subtitle,
  mode,
  heading,
  body,
  questions,
  disabledQuestion,
  actionHref,
  actionLabel,
  composerPlaceholder,
}: {
  workspace: WorkspaceKey;
  title: string;
  subtitle: string;
  mode: string;
  heading: string;
  body: string;
  questions: string[];
  disabledQuestion: string;
  actionHref: string;
  actionLabel: string;
  composerPlaceholder: string;
}) {
  const icons = [Search, FileText, LineChart];
  const { accent, tint } = workspaceTheme[workspace];

  return (
    <div className="flex h-full min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar workspace={workspace} title={title} subtitle={subtitle} mode={mode} />
        <div className="flex-1 flex items-center justify-center p-8 md:p-10">
          <div className="w-full max-w-[640px] border border-line rounded-md bg-surface p-7 md:p-9 flex flex-col gap-5.5 items-start">
            <span
              className="inline-flex items-center justify-center w-9 h-9 rounded-md"
              style={{ background: tint, color: accent }}
            >
              <LineChart size={19} strokeWidth={1.6} />
            </span>
            <div className="flex flex-col gap-2.5 w-full">
              <h1 className="m-0 font-bold text-[28px] md:text-[32px] leading-tight tracking-tight">
                {heading}
              </h1>
              <div className="w-[120px]">
                <WaveDivider color={accent} />
              </div>
              <p className="m-0 text-[15px] leading-[1.6] text-muted max-w-[480px]">{body}</p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              {questions.map((q, i) => {
                const Icon = icons[i];
                return (
                  <Link
                    key={q}
                    href={actionHref}
                    className="flex items-center gap-2.5 px-3.5 py-3 border border-line rounded-md text-[15px] hover:border-primary hover:text-primary"
                  >
                    <Icon size={17} strokeWidth={1.6} />
                    {q}
                  </Link>
                );
              })}
              <div className="flex items-center gap-2.5">
                <div
                  title="Not yet available"
                  className="flex-1 flex items-center gap-2.5 px-3.5 py-3 border border-line rounded-md text-[15px] opacity-40"
                >
                  <LineChart size={17} strokeWidth={1.6} />
                  {disabledQuestion}
                </div>
                <span className="bg-ink text-canvas text-[12px] px-2.5 py-2 rounded-md whitespace-nowrap hidden sm:inline">
                  Not yet available
                </span>
              </div>
            </div>
            <Link
              href={actionHref}
              className="mt-1 rounded-md bg-primary text-white px-4 py-2.5 text-[13px] font-semibold hover:bg-primary-hover"
            >
              {actionLabel}
            </Link>
          </div>
        </div>
        <ChatComposer placeholder={composerPlaceholder} disabled />
      </div>
      <SourcesPanel />
    </div>
  );
}
