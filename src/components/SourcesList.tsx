import { sourcesCited } from "@/lib/data";
import type { ConsultCitation } from "@/lib/consult/types";

/** The source-card list shared by SourcesPanel and any panel embedding a Sources tab. */
export default function SourcesList({ sources }: { sources?: ConsultCitation[] }) {
  const items =
    sources === undefined
      ? sourcesCited.map((source, index) => ({
          id: `static-source-${index + 1}`,
          title: source.title,
          href: undefined,
          meta: source.meta,
          body: source.body,
        }))
      : sources.map((source) => ({
          id: source.id,
          title: `${source.marker ? `[${source.marker}] ` : ""}${source.title}`,
          href: source.citationNamespace === "W" ? source.sourceUri : undefined,
          meta: [
            source.sourceType === "experience"
              ? "De-identified project experience · private provenance retained"
              : source.citationNamespace === "W"
                ? "Current public web"
                : source.citationNamespace === "S"
                  ? "Standard"
                  : source.citationNamespace === "B"
                    ? "Approved book · identity held privately"
                    : source.citationNamespace === "A"
                      ? "Attachment"
                      : source.citationNamespace === "E"
                        ? "Restricted email evidence"
                        : "Project document",
            source.section,
            source.pageNumber ? `p. ${source.pageNumber}` : undefined,
            source.retrievedAt
              ? `accessed ${new Intl.DateTimeFormat("en-IE", { dateStyle: "medium" }).format(
                  new Date(source.retrievedAt),
                )}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
          body: source.excerpt,
        }));

  if (items.length === 0) {
    return (
      <div className="border border-dashed border-line rounded-md bg-canvas p-4 text-[12px] leading-[1.55] text-muted">
        Sources from the approved Helmonic project and reference knowledge base will appear here
        after a successful query.
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
          {source.href ? (
            <a
              href={source.href}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[14px] text-primary hover:underline"
            >
              {source.title}
            </a>
          ) : (
            <div className="font-semibold text-[14px]">{source.title}</div>
          )}
          {source.meta && (
            <div className="text-[11px] text-faint tracking-[0.03em]">{source.meta}</div>
          )}
          <div className="text-[12px] leading-[1.55] text-muted">{source.body}</div>
        </div>
      ))}
    </>
  );
}
