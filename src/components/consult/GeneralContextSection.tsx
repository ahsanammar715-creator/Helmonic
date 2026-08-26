import type { ConsultQueryResponse } from "@/lib/consult/types";

export default function GeneralContextSection({
  context,
}: {
  context: ConsultQueryResponse["generalContext"];
}) {
  if (context.status === "disabled") return null;

  return (
    <section
      aria-label="General context not from your documents"
      className="mt-3 border border-dashed border-line rounded-md bg-canvas p-4 flex flex-col gap-3"
    >
      <div>
        <div className="text-[12px] font-semibold text-ink">
          General context — not from your documents
        </div>
        <div className="text-[11px] text-faint mt-1">
          This section is isolated from the controlled Sources panel.
        </div>
      </div>

      {context.text ? (
        <p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.65] text-sub">
          {context.text}
        </p>
      ) : (
        <p className="m-0 text-[13px] leading-[1.65] text-muted">
          {context.status === "insufficient-evidence"
            ? "No verified general references were available for this question."
            : "General context is designed but remains unavailable until an approved model and curated reference index are active."}
        </p>
      )}

      {context.citations.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col gap-2">
          {context.citations.map((citation) => (
            <li key={citation.id} className="text-[12px] leading-[1.55] text-muted">
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary hover:underline"
              >
                [{citation.marker}] {citation.title}
              </a>
              <span> · {citation.publisher}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
