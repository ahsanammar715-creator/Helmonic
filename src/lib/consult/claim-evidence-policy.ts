import type { ConsultCitation } from "@/lib/consult/types";

export type ControlledMarker = `D${number}` | `S${number}` | `B${number}` | `A${number}` | `E${number}`;

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

const controlledMarkerPattern = /\[([DSBAE]\d+)\]/g;
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

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export function extractCitedClaimBlocks(answer: string): CitedClaimBlock[] {
  return answer
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && substantive(block))
    .map((block, index) => ({
      id: `C${index + 1}` as const,
      text: block,
      markers: unique(
        Array.from(block.matchAll(controlledMarkerPattern), (match) => match[1] as ControlledMarker),
      ),
    }));
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
