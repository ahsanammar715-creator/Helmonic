import type { ConsultCitation } from "@/lib/consult/types";
import { validateDeidentifiedExperienceAnswer } from "./experience-evidence-policy.ts";

export type DocumentAnswerValidation = {
  valid: boolean;
  markers: Array<
    | `D${number}`
    | `S${number}`
    | `B${number}`
    | `A${number}`
    | `E${number}`
    | `W${number}`
  >;
  generalMarkers: Array<`G${number}`>;
  generalKnowledgeUsed: boolean;
  errors: string[];
};

export const NO_DOCUMENT_EVIDENCE_NOTICE =
  "The permitted Helmonic documents do not contain relevant evidence for this question.";

export function buildConsultSystemPrompt(input: {
  profile: string;
  allowGeneralKnowledge: boolean;
  experienceMode?: boolean;
}) {
  const answerPolicy = input.allowGeneralKnowledge
    ? `Write one natural, flowing answer. Claims supported by supplied project documents, standards, approved books, attachments, separately authorised email evidence, or current public-web evidence must use their exact [D#], [S#], [B#], [A#], [E#], or [W#] marker. You may add useful background from your own general knowledge only in separate paragraphs, and every such paragraph must use sequential markers starting at [G1]. Never mix a [G#] marker with a retrieved-evidence marker in the same paragraph. [G] markers are disclosure labels only: they are not verified sources and must never be described as document citations. Never identify or infer the hidden title, author, publisher, filename, URI, or section behind an approved-book [B#] marker. Email evidence may be used only when the separate restricted index has authorised the caller; never infer an email relationship from ordinary document evidence. Any paragraph using [W#] must explicitly frame the claim as current public or open-web evidence and must not contain a [D#], [S#], [B#], [A#], or [E#] marker. Never represent [W#] evidence as an internal Helmonic record. Do not invent a source, URL, standard, clause, measurement, page, or marker. If no evidence was supplied, begin with this exact sentence: "${NO_DOCUMENT_EVIDENCE_NOTICE}" You may then provide clearly marked general knowledge, or say that you do not know enough to answer reliably. Never let general knowledge conceal missing or conflicting document evidence.`
    : "Answer only from the supplied evidence. Cite every factual paragraph with one or more supplied project-document [D#], standard [S#], approved-book [B#], attachment [A#], separately authorised email [E#], or current public-web [W#] markers. Never identify or infer the hidden title, author, publisher, filename, URI, or section behind an approved-book [B#] marker. Email evidence may be used only when the separate restricted index has authorised the caller; never infer an email relationship from ordinary document evidence. Any paragraph using [W#] must explicitly frame the claim as current public or open-web evidence and must not contain a [D#], [S#], [B#], [A#], or [E#] marker. Never represent [W#] evidence as an internal Helmonic record. Never invent a source, clause, page, measurement, marker, or general-knowledge claim. If the evidence conflicts, identify the conflict and cite both sides in separate paragraphs. If it is insufficient, say so clearly and do not fill the gap from general knowledge.";

  const experiencePolicy = input.experienceMode
    ? ` Any [E#] passages are deterministically de-identified case evidence. Use them only for a pattern independently supported by at least three distinct [E#] cases. Every paragraph using [E#] must begin with "Based on experience across comparable projects" and cite at least three distinct [E#] markers. Never call this material email, correspondence, messages, client conversations, quotations, or sources. Never reveal or infer names, firms, projects, addresses, dates, contact details, document identifiers, or relationships. If fewer than three cases support a point, do not state it.`
    : "";

  return `You are Helmonic Consult for the fixed ${input.profile} evidence set, writing acoustician-to-acoustician. ${answerPolicy}${experiencePolicy} Every nonblank response block must end with at least one applicable evidence or disclosure marker. Avoid standalone headings, labels, lead-ins, table headers, and uncited conclusions; use short cited paragraphs instead. Use the technical register of a practising acoustic consultant: preserve distinctions such as Rw versus DnT,w, use C and Ctr only where supported, state frequency-dependent findings in octave- or one-third-octave-band terms, retain measurement conditions and uncertainty, and do not expand elementary acoustics concepts unless the question asks for it. Keep the answer concise, technically exact, and commercially usable.`;
}

type AnswerValidationOptions = {
  allowGeneralKnowledge?: boolean;
  requireWebEvidence?: boolean;
};

export function validateDocumentAnswerCitations(
  answer: string,
  citations: ConsultCitation[],
  options: AnswerValidationOptions = {},
): DocumentAnswerValidation {
  const allowed = new Set(
    citations.map((citation, index) => citation.marker ?? (`D${index + 1}` as const)),
  );
  const markers = Array.from(answer.matchAll(/\[([DSBAEW]\d+)\]/g), (match) =>
    match[1] as
      | `D${number}`
      | `S${number}`
      | `B${number}`
      | `A${number}`
      | `E${number}`
      | `W${number}`,
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

  if (/\[(?:\d+|[DSBAGE])\]/.test(answer)) {
    errors.push("The model answer uses a malformed citation marker.");
  }

  if (citations.length === 0 && markers.length > 0) {
    errors.push("The model answer cites document evidence that was not retrieved.");
  }

  const webMarkers = markers.filter((marker) => marker.startsWith("W"));
  if (options.requireWebEvidence && webMarkers.length === 0) {
    errors.push("The answer omits the retrieved public-web evidence marker.");
  }
  for (const block of answer.split(/\n\s*\n/g)) {
    const hasWebMarker = /\[W\d+\]/.test(block);
    if (!hasWebMarker) continue;
    if (/\[[DSBAE]\d+\]/.test(block)) {
      errors.push("A paragraph mixes public-web and private or controlled evidence markers.");
    }
    if (!/\b(?:current public|public web|open web|open-source|publicly available)\b/i.test(block)) {
      errors.push("A public-web paragraph is not explicitly framed as public evidence.");
    }
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

export function validateExperienceAnswer(answer: string, citations: ConsultCitation[]) {
  return validateDeidentifiedExperienceAnswer(answer, citations);
}
