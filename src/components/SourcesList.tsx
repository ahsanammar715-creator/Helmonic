import { sourcesCited } from "@/lib/data";

/** The source-card list shared by SourcesPanel and any panel embedding a Sources tab. */
export default function SourcesList() {
  return (
    <>
      {sourcesCited.map((s) => (
        <div
          key={s.title}
          className="border border-line rounded-md bg-surface p-3.5 flex flex-col gap-1.5 hover:border-primary"
        >
          <div className="font-semibold text-[14px]">{s.title}</div>
          <div className="text-[11px] text-faint tracking-[0.03em]">{s.meta}</div>
          <div className="text-[12px] leading-[1.55] text-muted">{s.body}</div>
        </div>
      ))}
    </>
  );
}
