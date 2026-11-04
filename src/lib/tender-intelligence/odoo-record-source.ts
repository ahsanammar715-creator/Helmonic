import { isQualifiedReviewRecord } from "./review-export-qualification.ts";
import type { TenderOpportunity } from "./types.ts";

type OpportunityDocument = {
  opportunities?: TenderOpportunity[];
};

type AuditDocument = {
  totals?: {
    qualifiedWorkingList?: number;
  };
};

function opportunities(document: OpportunityDocument | TenderOpportunity[], label: string) {
  const records = Array.isArray(document) ? document : document?.opportunities;
  if (!Array.isArray(records)) throw new Error(`${label} does not contain an opportunities array.`);
  return records;
}

/**
 * A controlled completed-ledger sync deliberately ignores a newer partial
 * discovery state. The ledger and its matching audit were written atomically
 * after the full document pass completed, so they are the durable source for
 * the final Odoo refresh.
 */
export function recordsForOdooSync({
  state,
  ledger,
  audit,
  useCompletedLedger,
}: {
  state: OpportunityDocument | TenderOpportunity[];
  ledger?: OpportunityDocument | TenderOpportunity[];
  audit?: AuditDocument;
  useCompletedLedger: boolean;
}) {
  if (!useCompletedLedger) return opportunities(state, "Pipeline state");
  if (!ledger) throw new Error("Completed-ledger Odoo sync was requested but the confirmed ledger is missing.");

  const records = opportunities(ledger, "Confirmed ledger");
  const auditCount = audit?.totals?.qualifiedWorkingList;
  if (!Number.isFinite(auditCount)) {
    throw new Error("Completed-ledger Odoo sync was requested but the completed audit count is missing.");
  }

  const ledgerCount = records.filter(isQualifiedReviewRecord).length;
  if (ledgerCount !== auditCount) {
    throw new Error(`Completed-ledger Odoo sync refused: ledger has ${ledgerCount} qualified records; audit reports ${auditCount}.`);
  }

  return records;
}
