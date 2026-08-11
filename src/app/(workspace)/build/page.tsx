import EmptyStateShell from "@/components/EmptyStateShell";
import { buildQuestions } from "@/lib/data";

export const metadata = { title: "Build · Helmonic" };

export default function BuildPage() {
  return (
    <EmptyStateShell
      workspace="build"
      title="Build"
      subtitle="Drawings, live BOM and indicative cost · Smart Studio"
      mode="Studio template v4"
      heading="What are we building?"
      body="Submit drawings, raise build tasks, or ask for a cost estimate. Every answer references the drawing revision it came from."
      questions={buildQuestions.slice(0, 2)}
      disabledQuestion={buildQuestions[2]}
      actionHref="/build/new"
      actionLabel="New studio build"
      composerPlaceholder="Ask Helmonic about this build…"
      showSources={false}
    />
  );
}
