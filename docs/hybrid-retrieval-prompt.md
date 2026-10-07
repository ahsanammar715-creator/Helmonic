# Prompt for Codex — attach the "Helmonic Phase 1A Architecture (Pilot Scope)" diagram alongside this file

This is a build spec, not reference material to review and summarize back.
Work through it in this order and don't skip ahead past step 4:

1. Reconcile the attached diagram against the live Phase 1A build and confirm
   you're reading the three corrections in this document correctly before
   touching any code.
2. Implement the hybrid-retrieval fix exactly as scoped below.
3. Update docs/phase1b-consult-design.md and the codebase together, in the
   same commit/PR — not as a separate follow-up pass.
4. Before creating any Azure resource (embedding deployment, new index,
   re-ingestion run), stop and give a cost estimate. Do not proceed on
   assumed approval.

Show the reconciliation from step 1 before moving on to implementation, so
any misreading gets caught early.

## Title

Close the Phase 1A retrieval gap against the original pilot-scope
architecture — hybrid/vector search, single model provider.

## Corrections to the attached diagram (confirm these, don't implement the diagram literally without them)

**Correction 1 — the "Out of Scope in Phase 1A" box is correct, leave it alone.**
Outlook/email ingestion, Planning Intelligence, Tender Intelligence,
Maps/Travel APIs, and Lead Generation/company research are confirmed out of
scope, matching the existing mock/placeholder workspaces already in the repo
(growth/leads, growth/tenders, logistics panels). No work is requested on
any of these. Do not build toward them.

**Correction 2 — single model provider only: GPT-5.5, not a dual-provider gateway.**
The diagram shows a "Helmonic Model Gateway" branching to both Azure OpenAI
and "Claude Hosted on Azure." That second branch does not apply — this build
uses one model provider, GPT-5.5 via Azure OpenAI (Data Zone Standard),
consistent with the actual decision log in docs/phase1b-consult-design.md
(D-007/D-008), which evaluated GPT-5.5, GPT-4.1, GPT-4o, Phi-4, and Mistral
Large 3 — Claude was never part of that evaluation. Do not build a second
model provider path or an Anthropic integration.

**Correction 3 — the lexical-only search is the actual bug this task fixes.**
The diagram's Search layer ("Azure AI Search — Vector + Hybrid + Semantic")
and its "Embed" step in the ingestion worker were part of the original
intended design but were never built. What's live today is lexical-only
keyword search: the `consult-demo-v1` index does BM25 matching via
queryType: "simple" (see scripts/ingestion/index-schema.json and
src/lib/server/search.ts) — no embeddings, no vector field, no similarity
scoring anywhere in the code. This is not a design choice to preserve or
work around — it is the bug this task exists to close.

Context on why it matters: this gap already has a tracked consequence in
docs/phase1b-consult-design.md's tech-debt list ("Retrieval relevance needs
an evaluation set and tuning; at least one broad query returned unrelated
Premier Inn passages for a Wetherspoon question"), and questions phrased
differently from the document text return zero keyword matches, which
src/app/api/consult/query/route.ts turns into `mode: "no-evidence"` before a
model is ever called. A RAG system that can't retrieve paraphrased or
naturally-phrased in-corpus questions isn't doing the job "RAG" implies.

## Goal

Add hybrid retrieval — BM25 keyword search fused with vector-embedding
similarity search (nearest-neighbor by cosine similarity), optionally
reranked by Azure AI Search's semantic ranker — to the controlled-document
retrieval path, matching the diagram's intended Search layer. Embeddings are
the core mechanism, not optional: every chunk needs a stored embedding, and
every query needs to be embedded the same way. This must preserve every
existing guarantee already established in the design doc: permission-scoped
filtering (D-013), server-authoritative citations (D-005), and the
no-evidence rule (D-004) — including for questions that are legitimately out
of scope (e.g. "what do you think sound is").

Keyword search is being kept deliberately, not just as a legacy leftover:
lexical matching is comparatively strong on exact numeric values, unit
strings, and standard/code references (e.g. "500 Hz," "Rw 45dB," "BS 4142")
— precisely where dense embeddings are weakest. The hybrid combination is
the actual safety net for numeric/tabular technical content, not a
transitional step to be removed later.

## The critical correctness requirement (read before implementing)

Vector search returns the k-nearest chunks by cosine similarity regardless of
whether any of them are actually relevant — unlike keyword search, it does
not naturally produce zero results for an out-of-scope question. If the
no-evidence gate stays as "citations.length === 0" after vector search is
added, an irrelevant question will start returning an unrelated chunk as if
it were valid grounding — a worse failure mode than today's honest
"insufficient evidence," because it looks like real cited evidence.

Therefore this task must:

1. Introduce an explicit minimum-relevance threshold (based on Azure AI
   Search's semantic reranker score if enabled, or otherwise a tuned
   RRF/vector-similarity cutoff) below which results are discarded before
   the citations array is built.
2. Build a small retrieval evaluation set BEFORE tuning that threshold:
   - genuine in-corpus questions phrased naturally (paraphrased, not copied
     from the document text),
   - the known regression case from the tech-debt note (a Wetherspoon-style
     query that must NOT return Premier Inn passages),
   - a handful of clearly out-of-scope questions (e.g. "what do you think
     sound is") that MUST still return no-evidence after this change,
   - at least one numeric/tabular lookup question (e.g. "what's the
     required Rw between X and Y") to confirm the hybrid keyword component
     is actually covering exact-value lookups that embeddings alone would
     likely miss or blur.
   Tune the threshold against this set and commit it as a fixtures file so
   the cutoff is reviewable and re-runnable, not a magic number.

## Implementation scope

1. **Embedding model**: deploy `text-embedding-3-small` as the initial
   embedding model, via Azure OpenAI Data Zone Standard (EU). Before
   deploying, directly verify in the Foundry portal that Data Zone Standard
   is actually offered for this model in an EU region at the time of
   deployment — published docs and community reports disagree on this, so
   confirm live rather than trusting either source. If the evaluation set
   above shows `text-embedding-3-small` missing genuinely-relevant
   paraphrased technical-terminology matches, `text-embedding-3-large` is
   the documented upgrade path — same Data Zone eligibility, ~5x the
   per-token cost. Do not assume quota or budget is available for either —
   this is a new deployment and needs its own cost approval (see Cost gate
   below), separate from and smaller than the GPT-5.5 chat deployment.
2. **Table-preserving extraction**: when re-ingesting for this change,
   ensure tables (e.g. octave-band/frequency compliance tables) are
   extracted as structured content (markdown table or explicit key-value
   form) and kept as a single atomic chunk rather than being flattened into
   plain text or split across a page-chunk boundary. This matters more for
   answer quality on numeric/tabular content than the embedding model choice
   itself.
3. **Index schema**: Azure AI Search generally cannot add a
   vector-configured field to an existing index in place. Create a new
   versioned index (e.g. consult-demo-v2) with the current fields plus a
   content_vector field (Collection(Edm.Single), matching the chosen
   embedding model's dimensions) and a vectorSearch profile/algorithm
   (HNSW). Keep consult-demo-v1 untouched and available as an instant
   rollback target, consistent with this repo's zero-traffic revision
   pattern applied to Search indexes, not just Container Apps revisions.
4. **Ingestion path**: update the re-ingestion step (scripts/ingestion or
   its Phase 1B manifest-driven successor) to compute one embedding per
   chunk via managed identity — no API keys (D-014) — and store it in
   content_vector in consult-demo-v2. Every chunk must have a vector before
   the index is considered ready for cutover — no partially-embedded index.
   Re-ingest the current sixteen controlled documents and validate parity
   (same chunk/page counts, same citations) against consult-demo-v1 before
   any cutover.
5. **Query path**: update src/lib/server/search.ts's searchConsultEvidence
   to embed the incoming question the same way and issue it as a
   vectorQueries entry alongside the existing keyword search, against
   consult-demo-v2, so both run in the same request and Azure AI Search
   fuses them (RRF, or semantic-ranker score if enabled). Keep the existing
   permission_scope filter applied exactly as today (it must still be
   enforced before scoring/fusion, not after). Wire the semantic-ranker or
   RRF score into the threshold check from the correctness requirement
   above.
6. **Cutover**: switch AZURE_SEARCH_INDEX to consult-demo-v2 only after the
   evaluation set passes and parity is validated, following the existing
   zero-traffic validation → explicit approval → staged traffic pattern
   already used for Container Apps revisions. Keep consult-demo-v1 as
   rollback until this is proven in the demo environment.

## Explicitly out of scope for this change

- No second model provider (see Correction 2).
- No general/open-domain knowledge blended into the document-grounded
  answer — that remains the separate Phase 1B-C general-context slice
  (D-009), a distinct source set, model call, response object, and [G]
  citation namespace.
- No work on any item in the diagram's "Out of Scope" box (see Correction 1).
- No changes to the root/port-80 runtime exception tracking.

## Testing and acceptance

- Extend tests/e2e/smoke.spec.ts (or add a retrieval-specific test) covering:
  a paraphrased in-corpus question now succeeds where it previously returned
  no-evidence; the Premier-Inn/Wetherspoon regression case stays correct;
  the "what do you think sound is" class of out-of-scope question still
  returns no-evidence; the numeric/tabular lookup question returns the
  correct value with a citation.
- Unit test the new threshold/cutoff logic in isolation from live Azure
  Search.
- Confirm permission_scope filtering still restricts results under hybrid
  mode (a permission-scope test case, not just a relevance one).

## Documentation and recordkeeping — required, not optional

Every architecture, data, security, or decision change made in this task
must be reflected in **both** the codebase and
`docs/phase1b-consult-design.md`, in the same commit/PR, per this repo's own
documentation-discipline rule (design doc section 22: "Every implementation
commit or working session must update... Architecture overview... File and
component map... Decision log... Current status... Cost and approval
boundaries"). Specifically:

- Add a new decision-log entry (next available D-0xx) recording: the
  hybrid-retrieval decision, the chosen embedding model and its Data Zone
  verification result, the versioned-reindex approach
  (consult-demo-v1 → v2), and the relevance-threshold requirement — including
  rejected alternatives (e.g. "mutate v1 in place — rejected, not
  supported/too risky without rollback"; "Claude as second provider — out of
  scope, see Correction 2").
- Update the architecture overview and file/component map for every new or
  changed file (embedding calls, new index schema, updated search.ts, new
  eval fixtures).
- Move the "Retrieval relevance needs an evaluation set and tuning"
  tech-debt item from Pending to Resolved (or update its status) once this
  lands, referencing the committed evaluation fixtures.
- Record the actual embedding deployment and its confirmed/estimated cost in
  the Cost and approval boundaries section once approved.
- Note explicitly in the doc that the attached "Pilot Scope" diagram has now
  been reconciled against the living reference, and record the corrections
  applied (single model provider; out-of-scope box confirmed unchanged).

Do not treat code and documentation as separate deliverables — a change
without its corresponding documentation update is not complete.

## Cost gate (do not skip)

Do not proceed with any Azure resource creation (embedding deployment, new
index, re-ingestion run) without first presenting a cost estimate and
getting explicit approval, per D-011. Stop and ask rather than assuming
approval.
