import { sourcesCited } from "@/lib/data";
import type { ConsultCitation } from "@/lib/consult/types";

/** The source-card list shared by SourcesPanel and any panel embedding a Sources tab. */
export default function SourcesList({ sources }: { sources?: ConsultCitation[] }) {
  const items =
    sources === undefined
      ? sourcesCited.map((source, index) => ({
          id: `static-source-${index + 1}`,
          title: source.title,
          meta: source.meta,
          body: source.body,
        }))
      : sources.map((source) => ({
          id: source.id,
          title: source.title,
          meta: [
            source.section,
            source.pageNumber ? `p. ${source.pageNumber}` : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          body: source.excerpt,
        }));

  if (items.length === 0) {
    return (
      <div className="border border-dashed border-line rounded-md bg-canvas p-4 text-[12px] leading-[1.55] text-muted">
        Sources from the five-document knowledge set will appear here after a successful query.
      </div>
    );
  }

  return (
    <>
      {items.map((source) => (
        <div
          key={source.id}
          className="border border-line rounded-md bg-surface p-3.5 flex flex-col gap-1.5 hover:border-primary"
        >
          <div className="font-semibold text-[14px]">{source.title}</div>
          {source.meta && (
            <div className="text-[11px] text-faint tracking-[0.03em]">{source.meta}</div>
          )}
          <div className="text-[12px] leading-[1.55] text-muted">{source.body}</div>
        </div>
      ))}
    </>
  );
}
