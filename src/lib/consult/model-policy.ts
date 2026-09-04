import type { ConsultCitation } from "@/lib/consult/types";

export type DocumentAnswerValidation = {
  valid: boolean;
  markers: Array<`D${number}` | `A${number}`>;
  generalMarkers: Array<`G${number}`>;
  generalKnowledgeUsed: boolean;
  errors: string[];
};

export const NO_DOCUMENT_EVIDENCE_NOTICE =
  "The permitted Helmonic documents do not contain relevant evidence for this question.";

type AnswerValidationOptions = {
  allowGeneralKnowledge?: boolean;
};

export function validateDocumentAnswerCitations(
  answer: string,
  citations: ConsultCitation[],
  options: AnswerValidationOptions = {},
): DocumentAnswerValidation {
  const allowed = new Set(
    citations.map((citation, index) => citation.marker ?? (`D${index + 1}` as const)),
  );
  const markers = Array.from(answer.matchAll(/\[([DA]\d+)\]/g), (match) =>
    match[1] as `D${number}` | `A${number}`,
  );
  const generalMarkers = Array.from(answer.matchAll(/\[(G\d+)\]/g), (match) =>
    match[1] as `G${number}`,
  );
  const errors: string[] = [];

  if (!answer.trim()) errors.push("The model answer is empty.");
  if (citations.length > 0 && markers.length === 0) {
    errors.push("The model answer has no document citation marker.");
  }

  const unsupported = [...new Set(markers.filter((marker) => !allowed.has(marker)))];
  if (unsupported.length > 0) {
    errors.push(`The model answer uses unsupported markers: ${unsupported.join(", ")}.`);
  }

  if (!options.allowGeneralKnowledge && generalMarkers.length > 0) {
    errors.push("The document-only answer uses a general-knowledge marker.");
  }

  const uniqueGeneralMarkers = [...new Set(generalMarkers)];
  if (options.allowGeneralKnowledge && uniqueGeneralMarkers.length > 0) {
    const expected = uniqueGeneralMarkers.map((_, index) => `G${index + 1}`);
    if (uniqueGeneralMarkers.some((marker, index) => marker !== expected[index])) {
      errors.push("General-knowledge markers must start at G1 and remain sequential.");
    }
  }

  if (/\[(?:\d+|[DAG])\]/.test(answer)) {
    errors.push("The model answer uses a malformed citation marker.");
  }

  if (citations.length === 0 && markers.length > 0) {
    errors.push("The model answer cites document evidence that was not retrieved.");
  }

  if (citations.length === 0 && options.allowGeneralKnowledge) {
    if (!answer.trimStart().startsWith(NO_DOCUMENT_EVIDENCE_NOTICE)) {
      errors.push("The answer does not disclose that the permitted documents lack evidence.");
    }
    if (
      generalMarkers.length === 0 &&
      !/\b(?:do not know|don't know|cannot answer|can't answer|insufficient information)\b/i.test(
        answer,
      )
    ) {
      errors.push("A no-evidence answer must mark general knowledge or state uncertainty.");
    }
  }

  return {
    valid: errors.length === 0,
    markers: [...new Set(markers)],
    generalMarkers: uniqueGeneralMarkers,
    generalKnowledgeUsed: generalMarkers.length > 0,
    errors,
  };
}
