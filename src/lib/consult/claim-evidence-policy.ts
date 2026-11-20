import type { ConsultCitation } from "@/lib/consult/types";

export type ControlledMarker =
  | `D${number}`
  | `S${number}`
  | `B${number}`
  | `A${number}`
  | `E${number}`
  | `W${number}`;

export type CitedClaimBlock = {
  id: `C${number}`;
  text: string;
  markers: ControlledMarker[];
};

export type ClaimSupportVerdict = {
  claimId: `C${number}`;
  supported: boolean;
  reason: string;
};

export const claimEvidenceAuditBatchSize = 6;

export function batchClaimEvidenceAudit(claims: CitedClaimBlock[]) {
  const batches: CitedClaimBlock[][] = [];
  for (let index = 0; index < claims.length; index += claimEvidenceAuditBatchSize) {
    batches.push(claims.slice(index, index + claimEvidenceAuditBatchSize));
  }
  return batches;
}

const controlledMarkerPattern = /\[([DSBAEW]\d+)\]/g;
const generalMarkerPattern = /\[(G\d+)\]/g;

function hasGeneralMarker(text: string) {
  return /\[G\d+\]/.test(text);
}

function substantive(block: string) {
  const withoutMarkdown = block
    .replace(controlledMarkerPattern, "")
    .replace(generalMarkerPattern, "")
    .replace(/[|#>*_`~-]/g, " ")
    .trim();
  return /[A-Za-z0-9]/.test(withoutMarkdown);
}

function structural(block: string) {
  const trimmed = block.trim();
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;

  // Report templates legitimately contain presentation-only blocks. They are
  // not factual claims and therefore do not need an evidence marker, but any
  // prose placed beneath them is still audited as a separate block.
  if (lines.length === 1 && trimmed.length <= 160) {
    if (/^#{1,6}\s+\S/.test(trimmed)) return true;
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) return true;
    if (/^\d+(?:\.\d+)*\.?\s+[A-Z][^.!?]*$/.test(trimmed)) return true;
  }

  const headingLine = lines[0] ?? "";
  const headingLike =
    /^#{1,6}\s+\S/.test(headingLine) ||
    /^\*\*[^*]+\*\*$/.test(headingLine) ||
    /^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(headingLine);
  const placeholderLine = (line: string) =>
    /\[(?:insert|enter|tbc|tbd|to be completed|not provided)[^\]]*\]/i.test(line) ||
    /<[^>]+>/.test(line) ||
    /_{3,}/.test(line) ||
    /^[-*]?\s*[A-Za-z][^:]{0,80}:\s*(?:TBC|TBD)?$/i.test(line) ||
    /^\|?\s*:?-{3,}/.test(line);
  if (headingLike && lines.length > 1 && lines.slice(1).every(placeholderLine)) {
    return true;
  }

  // A Markdown table header and separator describe layout rather than a
  // technical proposition. Data rows remain subject to the normal gate.
  if (
    lines.length === 2 &&
    lines.every((line) => line.includes("|")) &&
    /^\|?\s*:?-{3,}/.test(lines[1])
  ) {
    return true;
  }

  return false;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export function extractCitedClaimBlocks(answer: string): CitedClaimBlock[] {
  return answer
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && substantive(block) && !structural(block))
    .map((block, index) => ({
      id: `C${index + 1}` as const,
      text: block,
      markers: unique(
        Array.from(block.matchAll(controlledMarkerPattern), (match) => match[1] as ControlledMarker),
      ),
    }));
}

export function filterUncitedAnswerClaims(
  answer: string,
  allowGeneralKnowledge: boolean,
) {
  let removedClaimCount = 0;
  const retained = answer
    .split(/\n\s*\n/g)
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed || !substantive(trimmed) || structural(trimmed)) return true;
      const hasControlledMarker = /\[[DSBAEW]\d+\]/.test(trimmed);
      if (hasControlledMarker) return true;
      if (allowGeneralKnowledge && hasGeneralMarker(trimmed)) return true;
      removedClaimCount += 1;
      return false;
    })
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");

  return { answer: retained, removedClaimCount };
}

export function filterUnsupportedAnswerClaims(
  answer: string,
  unsupportedClaimIds: string[],
) {
  const unsupported = new Set(unsupportedClaimIds);
  let substantiveIndex = 0;
  let removedClaimCount = 0;
  const retained = answer
    .split(/\n\s*\n/g)
    .filter((block) => {
      const trimmed = block.trim();
      if (!trimmed || !substantive(trimmed)) return true;
      substantiveIndex += 1;
      if (!unsupported.has(`C${substantiveIndex}`)) return true;
      removedClaimCount += 1;
      return false;
    })
    .map((block) => block.trim())
    .filter(Boolean)
    .join("\n\n");

  return { answer: retained, removedClaimCount };
}

export function renumberGeneralKnowledgeMarkers(answer: string) {
  let markerNumber = 0;
  return answer.replace(/\[G\d+\]/g, () => {
    markerNumber += 1;
    return `[G${markerNumber}]`;
  });
}

export function validateClaimCitationCoverage(input: {
  answer: string;
  allowGeneralKnowledge: boolean;
}) {
  const errors: string[] = [];
  const claims = extractCitedClaimBlocks(input.answer);

  for (const claim of claims) {
    const containsGeneralMarker = hasGeneralMarker(claim.text);
    if (claim.markers.length === 0 && !(input.allowGeneralKnowledge && containsGeneralMarker)) {
      errors.push(`${claim.id} is a substantive answer block without a retrieved evidence marker.`);
    }
    if (claim.markers.length > 0 && containsGeneralMarker) {
      errors.push(
        `${claim.id} mixes retrieved evidence and general knowledge; put them in separate paragraphs.`,
      );
    }
  }

  return { valid: errors.length === 0, claims, errors };
}

export function buildClaimEvidenceAudit(input: {
  claims: CitedClaimBlock[];
  citations: ConsultCitation[];
}) {
  const byMarker = new Map(
    input.citations.flatMap((citation, index) => {
      const marker = citation.marker ?? (`D${index + 1}` as ControlledMarker);
      return [[marker, citation] as const];
    }),
  );

  const claims = input.claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    evidence: claim.markers.map((marker) => {
      const citation = byMarker.get(marker);
      if (!citation) {
        throw new Error(`Missing retrieved evidence for ${marker}.`);
      }
      return {
        marker,
        excerpt: citation.excerpt,
        ...(citation.citationNamespace === "W"
          ? {
              sourceTitle: citation.title,
              sourceUri: citation.sourceUri,
            }
          : {}),
      };
    }),
  }));

  return { claims };
}

export function validateClaimSupportVerdicts(input: {
  claims: CitedClaimBlock[];
  verdicts: ClaimSupportVerdict[];
}) {
  const expected = new Set(input.claims.map((claim) => claim.id));
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const verdict of input.verdicts) {
    if (!expected.has(verdict.claimId)) {
      errors.push(`The evidence audit returned an unknown claim id: ${verdict.claimId}.`);
      continue;
    }
    if (seen.has(verdict.claimId)) {
      errors.push(`The evidence audit returned ${verdict.claimId} more than once.`);
      continue;
    }
    seen.add(verdict.claimId);
    if (!verdict.supported) {
      errors.push(`${verdict.claimId} is not supported by its cited excerpts: ${verdict.reason}`);
    }
  }

  for (const claimId of expected) {
    if (!seen.has(claimId)) errors.push(`The evidence audit omitted ${claimId}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    unsupportedClaimIds: input.verdicts
      .filter((verdict) => expected.has(verdict.claimId) && !verdict.supported)
      .map((verdict) => verdict.claimId),
  };
}
