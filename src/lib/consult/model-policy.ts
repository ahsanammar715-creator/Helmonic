import type { ConsultCitation } from "@/lib/consult/types";

export type DocumentAnswerValidation = {
  valid: boolean;
  markers: Array<`D${number}` | `A${number}`>;
  errors: string[];
};

export function validateDocumentAnswerCitations(
  answer: string,
  citations: ConsultCitation[],
): DocumentAnswerValidation {
  const allowed = new Set(
    citations.map((citation, index) => citation.marker ?? (`D${index + 1}` as const)),
  );
  const markers = Array.from(answer.matchAll(/\[([DA]\d+)\]/g), (match) =>
    match[1] as `D${number}` | `A${number}`,
  );
  const errors: string[] = [];

  if (!answer.trim()) errors.push("The model answer is empty.");
  if (markers.length === 0) errors.push("The model answer has no document citation marker.");

  const unsupported = [...new Set(markers.filter((marker) => !allowed.has(marker)))];
  if (unsupported.length > 0) {
    errors.push(`The model answer uses unsupported markers: ${unsupported.join(", ")}.`);
  }

  if (/\[(?:G\d+|\d+)\]/.test(answer)) {
    errors.push("The document answer mixes general or numeric citation markers.");
  }

  return {
    valid: errors.length === 0,
    markers: [...new Set(markers)],
    errors,
  };
}
