import EmptyStateShell from "@/components/EmptyStateShell";
import { consultQuestions } from "@/lib/data";

export const metadata = { title: "Consult · Helmonic" };

export default function ConsultPage() {
  return (
    <EmptyStateShell
      workspace="consult"
      title="Consult"
      subtitle="Standards-bound answers · iAcoustics"
      mode="Standards mode on"
      heading="What do you need to know?"
      body="Ask about criteria, materials, or measurement method. Answers cite the standard or project record they came from."
      questions={consultQuestions.slice(0, 2)}
      disabledQuestion={consultQuestions[2]}
      actionHref="/consult/new"
      actionLabel="New survey project"
      composerPlaceholder="Ask Helmonic about this project…"
    />
  );
}
