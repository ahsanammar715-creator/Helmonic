# Helmonic Consult Living Reference

Status: Authoritative living reference for the active Phase 1A/1B branch

Last reviewed: 4 September 2026

Repository branch: `phase1a-consult-demo`

Product area: Helmonic Consult

Baseline: Phase 1A retrieval and server-authoritative document citations

Hosting path: Container App-hosted UI and API, same origin

## Document governance

This is the single comprehensive reference for the Helmonic Consult Azure build. It is
not a point-in-time handoff. Every material application, data, security, deployment,
cost, or architecture change must update this file in the same pull request or commit.

Update this document when any of the following occurs:

- a Phase 1B feature is implemented, enabled, disabled, or materially redesigned;
- a model, Speech resource, index, Blob container, database schema, identity, role,
  endpoint, or other Azure dependency is added or changed;
- traffic moves to a new Container Apps revision;
- a temporary identity, image, payload, role assignment, or resource is created or
  removed;
- a security, data-handling, retention, or citation policy changes;
- a material technical-debt item is opened or closed;
- a cost estimate, budget, quota, or subscription state changes;
- the local worktree, branch, pull request, or deployment access point changes.

Historical handoffs and focused decision records can remain in `docs/`, but when they
conflict with this file, this living reference is authoritative. It contains no secret
values, access tokens, resource keys, passwords, or local credential payloads.

## Access points and canonical locations

### Source control

| Item | Location |
| --- | --- |
| Local worktree | `C:\Users\Alessandro.Saccarola\Documents\Codex\2026-08-21\referenced-chatgpt-conversation-this-is-an\work\Helmonic-phase1a` |
| GitHub repository | `https://github.com/ahsanammar715-creator/Helmonic` |
| Active branch | `phase1a-consult-demo` |
| Branch URL | `https://github.com/ahsanammar715-creator/Helmonic/tree/phase1a-consult-demo` |
| Draft pull request | `https://github.com/ahsanammar715-creator/Helmonic/pull/16` |
| Pull request title | `Build Phase 1A Consult runtime slice` |
| Living reference | `docs/phase1b-consult-design.md` |

No additional repository or implementation branch is approved for Phase 1B. Work must
remain in this worktree and branch unless the owner explicitly changes this rule.

### Azure

| Item | Name/location |
| --- | --- |
| Subscription | `14f94f77-4e71-4b80-b6c9-e09b192fcf42`; Active/Paid PAYG (`PayAsYouGo_2014-09-01`) |
| Resource group | `RG-HELMONIC-DEV` |
| Region | North Europe |
| Container Apps environment | `cae-helmonic-dev-002` |
| Container App | `ca-helmonic-consult-dev-002` |
| Authenticated application URL | `https://ca-helmonic-consult-dev-002.politemushroom-54e7948a.northeurope.azurecontainerapps.io` |
| Current real revision | `ca-helmonic-consult-dev-002--hyb570514c` (`helmonic-consult:570514ca8733453dbd98ad0c32ecc6bbd69a8912`), 100% traffic, `consult-demo-v2`, hybrid/semantic retrieval, non-root UID 1000, port 8080, minimum replicas 0 |
| Immediate v1 rollback | `ca-helmonic-consult-dev-002--p1bgpt55fin`, active at 0% traffic with `consult-demo-v1` |
| Prior Target B rollback | `ca-helmonic-consult-dev-002--p1b69b6b7a`, active at 0% traffic |
| Prior real rollback revision | `ca-helmonic-consult-dev-002--ca72a0c`, active at 0% traffic; rollback also requires restoring ingress port 80 |
| Placeholder rollback revision | `ca-helmonic-consult-dev-002--0000001`, active at 0% traffic |
| Container registry | `acrhelmonicdev001` |
| Application image repository | `helmonic-consult` |
| ACR pull identity | `uami-helmonic-acr-001` |
| Key Vault | `kv-helmonic-dev-001` |
| PostgreSQL server | `psql-helmonic-dev-001` |
| PostgreSQL database | `helmonic_consult_dev` |
| Storage account | `sthelmonicdev001` |
| Controlled-source Blob container | `consult-sources` |
| Azure AI Search service | `srch-helmonic-dev-001` |
| Live controlled-source Search index | `consult-demo-v2`; versioned hybrid/semantic index |
| Immediate controlled-source rollback index | `consult-demo-v1`; immutable lexical rollback target |
| Service Bus namespace | `sb-helmonic-dev-001` |
| Service Bus queue | `consult-ingestion` |
| Foundry account | `aif-helmonic-dev-001` |
| Embedding account | `aif-helmonic-embed-dev-001`; France Central, public access disabled |
| Embedding deployment | `text-embedding-3-small-helmonic-dev`; version 1, `DataZoneStandard`, capacity 1 |
| Embedding private endpoint | `pe-ai-embed-helmonic-dev-001`; `10.36.1.11`, approved, with dedicated `privatelink.openai.azure.com` zone linked to `vnet-helmonic-dev-001` |
| Log Analytics | `law-helmonic-dev-001` |

The application URL is intentionally protected by Microsoft Entra authentication and
the approved source-IP restriction. CORS is unset/disabled. Vercel is not an API client.

## Architecture overview

### Current Phase 1A request path

```text
Authenticated browser on approved source IP
        |
        | same-origin HTTPS; CORS disabled
        v
Azure Container App
  Next.js UI + server Route Handlers (BFF)
        |
        | server-derived identity and permission filters
        v
Azure AI Search through private endpoint
  consult-demo-v2 hybrid/semantic retrieval (current live index)
        |
        +--> no evidence: explicit insufficient-evidence response
        |
        `--> permitted evidence
                 |
                 v
            Model Gateway
              GPT-5.5 only, managed identity, Data Zone Standard
                 |
                 v
            grounded generated answer + Sources panel
```

The browser never receives Azure service credentials and does not call PostgreSQL,
Blob, Search, Key Vault, Service Bus, Foundry, or Speech directly.

### Same-origin BFF

The Next.js application is the browser-facing Backend for Frontend (BFF):

- UI and API share the Container App origin.
- Platform authentication and IP filtering run before application code.
- CORS is disabled because no cross-origin production path is approved.
- Route Handlers validate input, derive the trusted user identity, apply authorization,
  call Azure dependencies through server-side identities, and shape safe responses.
- Vercel remains an independent public mock/preview and is not connected to live data.

### Permission-first retrieval

Authorization is applied before retrieval, not after results are returned:

1. obtain the trusted Entra object identifier and application profile;
2. resolve the conversation and permitted source scopes in PostgreSQL;
3. construct server-owned Search filters;
4. query only permitted indexes/documents;
5. reject results that fail the expected ownership/classification contract;
6. pass only the permitted evidence to the answer layer.

The browser cannot choose another owner ID, permission scope, or effective Search
filter. Phase 1B session attachments add both owner and conversation filters.

### Model Gateway

The Model Gateway is a server-only application boundary, not a separately exposed
public API. It has one approved provider path: GA GPT-5.5 `2026-04-24` through Azure
OpenAI Data Zone Standard. `src/lib/server/model.ts` implements that adapter and the
provider-neutral contract:

- exposes one internal answer interface to Consult;
- selects only explicitly configured Azure deployments;
- deliberately has no Claude, Anthropic, Mistral, or other secondary provider path;
- keeps retrieval-only Target B available when no model is usable;
- separates document-answer calls from general-context calls;
- prevents confidential evidence from reaching public-web connectors;
- validates citation markers against server-provided sources;
- records model/deployment identifiers, latency, token usage, and safe failure reasons;
- enforces per-request limits and future cost budgets;
- uses managed identity for Azure model access.

Deployment `gpt-5-5-helmonic-dev` is live at 10 kTPM. The gateway still degrades to
retrieval-only Target B without weakening evidence or citation controls when model
configuration is absent.

### Managed-identity-only security

The standing target is credentialless application access:

- system-assigned Container App identity for runtime data-plane access;
- dedicated user-assigned identity for ACR pull;
- branch-scoped GitHub OIDC for image publishing;
- dedicated least-privilege worker identity for future ongoing ingestion;
- separate controlled migration/bootstrap authority for schema changes;
- no ACR admin account, storage keys, database passwords, model keys, or long-lived
  service-principal secrets in source, images, or browser code.

If a proposed Speech/private-endpoint SDK path cannot operate with managed identity, it
is not silently allowed to introduce a resource key. The path must be redesigned or a
specific documented security exception must be approved before deployment.

### Zero-traffic validation pattern

Every runtime change follows this release path:

```text
commit on approved branch
  -> GitHub OIDC build
  -> immutable ACR image tag
  -> new Container Apps revision at 0% traffic
  -> health/readiness/security/dependency/citation validation
  -> explicit approval
  -> staged traffic movement
  -> retain known-good rollback revision
```

Database migrations must remain compatible with the rollback revision. An unhealthy or
unauthorized revision never receives traffic.

## File and component map

### Build, deployment, and repository controls

| Path | Responsibility |
| --- | --- |
| `.dockerignore` | Excludes local dependencies, build output, environment files, and development artifacts from container build context |
| `.env.example` | Non-secret Phase 1A runtime, GPT, and disabled hybrid-retrieval configuration contract |
| `.gitignore` | Excludes dependencies, build/test output, local environment files, Vercel state, and generated TypeScript files |
| `.nvmrc` | Tested Node.js runtime version |
| `AGENTS.md` | Repository-specific Next.js agent rule requiring bundled framework documentation to be consulted |
| `CLAUDE.md` | Points compatible coding agents to the same `AGENTS.md` instructions |
| `package.json` | Application metadata, Next.js/React/Azure/PostgreSQL dependencies, lint/type/build/test scripts, runtime-hardening verification, and retrieval/generated-answer evaluation commands |
| `package-lock.json` | Exact npm dependency lock for reproducible installation |
| `eslint.config.mjs` | Next.js Core Web Vitals and TypeScript lint configuration |
| `postcss.config.mjs` | Tailwind CSS v4 PostCSS integration |
| `tsconfig.json` | Strict TypeScript, App Router type generation, and `@/*` source alias configuration |
| `Dockerfile` | Self-hosted Next.js image using the non-root `node` user, owned runtime files, and unprivileged port `8080` |
| `next.config.ts` | Next.js configuration and standalone container output |
| `.github/workflows/ci.yml` | Branch/PR quality checks, including the non-root/port-8080 source guard |
| `.github/workflows/phase1a-consult-build.yml` | Branch-scoped GitHub OIDC build and immutable ACR publication, blocked if runtime hardening regresses |
| `playwright.config.ts` | End-to-end browser-test configuration |
| `scripts/verify-runtime-hardening.mjs` | Fails local/CI/image builds if root, port 80, or the expired exception label returns |
| `tests/e2e/smoke.spec.ts` | Route smoke tests, fail-closed/runtime-user tests, Phase 1B disabled-boundary checks, UI flows, responsive behavior, settings, current corpus copy, and legacy mock attachment coverage |
| `scripts/evaluation/consult-retrieval.json` | Versioned eight-case hybrid fixture covering paraphrase, Wetherspoon/Premier Inn regression, numeric tables, no-evidence, and permission pre-filter behavior; owns the reviewable candidate cutoffs |
| `scripts/evaluation/run-consult-retrieval.mjs` | Offline hybrid-suite/request validation and opt-in private v2 evaluation; live execution explicitly selects the ingestion UAMI through `AZURE_CLIENT_ID` before acquiring embedding or Search tokens |
| `scripts/evaluation/relevance-policy.test.mjs` | Isolated unit tests for semantic/RRF cutoffs, missing-score failure, embedding validation, and permission pre-filter construction |
| `scripts/evaluation/managed-identity-selection.test.mjs` | Regression tests proving temporary jobs select the configured UAMI and fail closed when `AZURE_CLIENT_ID` is missing or blank |
| `scripts/evaluation/index-parity.test.mjs` | Regression tests proving v2 manifest validation tolerates only bounded Azure Search indexing delay while preserving exact fail-closed chunk and metadata parity |
| `scripts/evaluation/run-consult-generated.mjs` | Offline citation-policy validation and opt-in Target A evaluation through the same-origin API using eligible v2 cases |

### App Router surfaces

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Public Helmonic landing page and workspace routing |
| `src/app/layout.tsx` | Root application shell and global metadata |
| `src/app/globals.css` | Global Tailwind import, design tokens, light/dark themes, responsive behavior, and shared animations |
| `src/app/favicon.ico` | Browser favicon |
| `src/app/(workspace)/layout.tsx` | Workspace shell with shared navigation |
| `src/app/(workspace)/consult/page.tsx` | Real Phase 1A Consult entry point |
| `src/app/(workspace)/consult/new/page.tsx` | Existing mock/new-project Consult workflow |
| `src/app/(workspace)/consult/report/page.tsx` | Existing report-preview workflow |
| `src/app/(workspace)/build/page.tsx` | Build workspace entry/empty state; outside current Consult delivery |
| `src/app/(workspace)/build/new/page.tsx` | Interactive mock specification, cost, BOM, and source workflow |
| `src/app/(workspace)/build/bom/page.tsx` | Printable/export-style mock bill-of-materials view |
| `src/app/(workspace)/logistics/page.tsx` | Existing Logistics UI demonstration |
| `src/app/(workspace)/growth/layout.tsx` | Growth sub-navigation shared by Marketing, Leads, and Tenders |
| `src/app/(workspace)/growth/page.tsx` | Redirect/entry behavior for Growth |
| `src/app/(workspace)/growth/marketing/page.tsx` | Mock conversational marketing and drafts workflow |
| `src/app/(workspace)/growth/leads/page.tsx` | Mock Smart Studio leads and iAcoustics planning-signals modes |
| `src/app/(workspace)/growth/tenders/page.tsx` | Mock Ireland-wide tender-intelligence workflow and Consult handoff |
| `src/app/api/consult/query/route.ts` | Same-origin Consult query API, controlled/session Search orchestration, retrieval-only/model modes, and feature-gated single-answer general-knowledge fallback |
| `src/app/api/consult/conversations/route.ts` | Owner-scoped list/create API for persistent Consult conversations; disabled until Phase 1B persistence activation |
| `src/app/api/consult/conversations/[conversationId]/documents/route.ts` | Authenticated, owner-scoped PDF upload endpoint that streams to session Blob and queues ingestion |
| `src/app/api/consult/folders/route.ts` | Owner-scoped list/create API for nested Consult folders |
| `src/app/api/consult/folders/[folderId]/route.ts` | Owner-scoped folder rename API |
| `src/app/healthz/route.ts` | Process/liveness response plus runtime UID/non-root evidence on supported operating systems |
| `src/app/readyz/route.ts` | Managed-identity dependency readiness response |

### Consult and shared UI components

| Path | Responsibility |
| --- | --- |
| `src/components/consult/ConsultWorkspace.tsx` | Live Consult state, query/conversation/upload calls, single-answer rendering, persistent `[G]` disclosure, and active document citations |
| `src/components/ChatComposer.tsx` | Shared text composer with uploading/queued/ready/failed attachment state |
| `src/components/AttachPopover.tsx` | File picker/drag-drop control that passes the selected `File` to an approved upload handler |
| `src/components/ChatBubble.tsx` | User and assistant message presentation |
| `src/components/SourcesPanel.tsx` | Right-side citation panel for the active answer |
| `src/components/SourcesList.tsx` | Shared source-list presentation used by mock workflows |
| `src/components/Sidebar.tsx` | Workspace navigation and mock Recent list; Phase 1B persistence target |
| `src/components/TopBar.tsx` | Workspace title, subtitle, mode, and panel controls |
| `src/components/MobileTabBar.tsx` | Responsive mobile workspace navigation |
| `src/components/EmptyStateShell.tsx` | Shared empty-state layout |
| `src/components/SettingsPanel.tsx` | Existing settings popover |
| `src/components/HelmonicMark.tsx` | Helmonic brand mark |
| `src/components/RadiatingMark.tsx` | Animated/radiating assistant mark |
| `src/components/WaveDivider.tsx` | Shared decorative divider |
| `src/components/leads/SmartStudioLeadsPanel.tsx` | Mock Smart Studio company-research funnel, ranked leads, and company intelligence |
| `src/components/leads/PlanningSignalsPanel.tsx` | Mock iAcoustics planning-signal scanning with separated source facts and Helmonic analysis |
| `src/components/logistics/SmartStudioPanel.tsx` | Mock Smart Studio travel-planning and cost panel |
| `src/components/logistics/IAcousticsPanel.tsx` | Mock iAcoustics engagement/site-visit planning panel |

### Static assets

| Path | Responsibility |
| --- | --- |
| `public/images/jim-dunne.png` | Founder image used by the landing-page vision content |
| `public/images/smart-studio-mix-room.jpg` | Smart Studio product/landing visual |

### Server and domain modules

| Path | Responsibility |
| --- | --- |
| `src/lib/consult/types.ts` | Consult single-answer, document/attachment citation, and general-knowledge-use response contracts |
| `src/lib/consult/corpus.ts` | Single application source of truth for the current controlled-document count and label |
| `src/lib/consult/search-policy.ts` | Pure lexical/hybrid request construction, permission pre-filtering, reviewable cutoff constants, and fail-closed relevance filtering shared by runtime and evaluation tooling |
| `src/lib/consult/model-policy.ts` | Pure fail-closed `D`/`A` validator plus opt-in sequential `G` marker and explicit no-document-evidence policy |
| `src/lib/consult/organization.ts` | Folder/conversation persistence DTOs |
| `src/lib/consult/uploads.ts` | Session-document lifecycle and composer attachment DTOs |
| `src/lib/server/config.ts` | Runtime environment parsing, defaults, and fail-closed lexical/hybrid/model/embedding completeness checks |
| `src/lib/server/azure-credential.ts` | Managed-identity/default Azure credential token acquisition |
| `src/lib/server/search.ts` | Permission-scoped controlled lexical/hybrid retrieval, relevance filtering before citation creation, session Search, and citation shaping |
| `src/lib/server/embeddings.ts` | Managed-identity query-embedding client with strict deployment, dimension, timeout, and finite-vector validation |
| `src/lib/server/model.ts` | Managed-identity Azure GPT implementation of the Model Gateway with high reasoning, bounded output, one-call document/general prompting, strict marker validation, and usage telemetry |
| `src/lib/server/model-gateway.ts` | Provider-neutral single-answer request contract and validation error boundary |
| `src/lib/server/postgres.ts` | Managed-identity PostgreSQL connection wrapper used by readiness and repositories |
| `src/lib/server/consult-repository.ts` | Transactional, owner-scoped folder, conversation, upload, and ingestion-job persistence |
| `src/lib/server/identity.ts` | Platform-authenticated actor extraction from Container Apps auth headers |
| `src/lib/server/session-blob.ts` | Single-pass PDF signature/hash validation and managed-identity Blob streaming |
| `src/lib/server/service-bus.ts` | Managed-identity REST dispatch for versioned session-ingestion messages |
| `src/lib/server/readiness.ts` | Search, PostgreSQL, Blob, Key Vault, model, and embedding configuration/identity checks |
| `src/lib/data.ts` | Original illustrative/mock data; not authoritative backend data |
| `src/lib/useSessionBoolean.ts` | Session-only panel preference helper |
| `src/lib/workspaceTheme.ts` | Workspace color/theme mapping |
| `src/lib/theme.ts` | Shared theme definitions |
| `src/lib/currency.ts` | Shared currency display helpers |

### Controlled ingestion

| Path | Responsibility |
| --- | --- |
| `scripts/ingestion/index-schema.json` | Current `consult-demo-v1` Search schema |
| `scripts/ingestion/index-schema-v2.json` | Proposed `consult-demo-v2` schema with table metadata, a 1,536-dimension vector field, cosine HNSW, and `consult-semantic-v2` |
| `scripts/ingestion/session-index-schema.json` | Proposed isolated, owner/conversation-filterable `consult-session-v1` Search schema |
| `scripts/ingestion/payload.example.json` | Non-sensitive extraction-v2 example including atomic table metadata alongside source/chunk/page/hash fields |
| `scripts/ingestion/README.md` | Operator instructions, corpus-count gate, explicit multi-UAMI client-ID contract, versioned hybrid re-index safety contract, and least-privilege separation |
| `scripts/managed-identity.mjs` | Shared fail-closed constructor that requires `AZURE_CLIENT_ID` and creates an explicitly targeted `ManagedIdentityCredential` for temporary multi-UAMI jobs |
| `scripts/ingestion/index-parity.mjs` | Exact v1/v2 chunk-metadata parity checks plus a bounded retry window for Azure Search's asynchronous indexing visibility |
| `scripts/ingestion/upload-payload.mjs` | Controlled writer with an explicitly selected ingestion UAMI, opt-in embeddings, bounded Azure 429/`Retry-After` handling, table validation, v1/v2 parity, all-vector readiness, and v1 rollback protection |
| `scripts/evaluation/model-answer-policy.test.mjs` | Offline contract tests for document-only, blended document/general, general-only no-evidence, and honest uncertainty answers |
| `scripts/ingestion/build-hybrid-payload.py` | Private-job payload builder that reads only retrievable v1 manifest fields and controlled Blob originals, requires the permission scope explicitly because v1 keeps it non-retrievable, preserves detected PDF tables as atomic Markdown, and retains v1 identifiers/page metadata for parity |
| `scripts/ingestion/Dockerfile.hybrid` | Temporary non-root hybrid-validation image combining table-preserving extraction, the shared explicit-UAMI helper, the v2 uploader, and the eight-case private retrieval evaluation in one fail-closed job |
| `scripts/ingestion/standing-worker-proof-contract.mjs` | Fail-closed synthetic-target contract restricting the standing-worker proof to the isolated session Blob container, session Search index, approved embedding dimensions, and an explicit UAMI client ID |
| `scripts/ingestion/standing-worker-proof-contract.test.mjs` | Offline proof that the standing-worker validation cannot target the live controlled index, audio container, malformed proof IDs, or a non-1,536-dimensional embedding contract |
| `scripts/ingestion/probe-standing-worker.mjs` | Disposable-job entrypoint that proves the persistent ingestion UAMI through synthetic Blob upload/read/delete, one embedding, and isolated Search write/query/delete with terminal cleanup checks |
| `scripts/ingestion/Dockerfile.standing-worker-proof` | Minimal non-root validation image containing only the shared explicit-UAMI helper and standing-worker synthetic proof code |
| `scripts/corpus_audit/audit_corpus.py` | Read-only, resumable inventory of the approximately 300 GB source collection: checklist mapping, format/integrity checks, page-level OCR triage, and exact/possible duplicate reporting without retaining extracted text |
| `scripts/corpus_audit/run-corpus-audit.ps1` | Normal-Windows launcher for the mapped company share; fixes source/output boundaries and selects the bundled Python document runtime |
| `scripts/corpus_audit/test_audit_corpus.py` | Synthetic end-to-end safety, exclusion, mapping, OCR-candidate, broken-file, and duplicate regression coverage |
| `scripts/corpus_audit/build_ingestion_plan_analysis.py` | Reconciles the completed audit, derives conservative deduplicated/held ingestion populations, and fails the plan profile when source totals or safety checks disagree |
| `scripts/corpus_audit/test_ingestion_plan_analysis.py` | Regression proof that a duplicate crossing an approved and unresolved classification remains held rather than bypassing governance through its second path |
| `scripts/corpus_audit/build_full_ingestion_manifest.py` | Builds the ignored capture-all JSONL manifest for every audited approved original, using opaque Blob identities, canonical-copy links, format processing lanes, classification holds, and fail-closed permission scope |
| `scripts/corpus_audit/test_full_ingestion_manifest.py` | Synthetic proof that all audited originals are retained, duplicate/category holds propagate, specialist formats are catalogued, books use the `B` namespace, and Search permission is never guessed |
| `scripts/corpus_audit/build_corpus_pilot_payload.py` | Deterministic 100-PDF coordinator with one bounded child process per source, atomic per-source checkpoints, hash-verified resume, and fail-closed manual-review reporting |
| `scripts/corpus_audit/corpus_document_worker.py` | Per-document copier/extractor enforcing the standard pdfminer/pdfplumber plus pypdf integrity decision, atomic table preservation, and quarantine without OCR or invented content |
| `scripts/corpus_audit/diagnose_corpus_pilot_extraction.py` | Independent two-reader cross-check for the already-staged pilot, retaining opaque source IDs and completeness outcomes rather than document content |
| `scripts/corpus_audit/prepare-corpus-pilot-context.ps1` | Normal-Windows private staging launcher that permits only a compatible checkpointed resume and packages the isolated candidate-ingestion context |
| `scripts/corpus_audit/test_corpus_pilot_payload.py` | Offline selection and hardening tests covering exclusions, two-reader outcomes, worker timeout, worker memory termination, and checkpoint mismatch rejection |
| `scripts/corpus_audit/README.md` | Corpus-audit operating instructions, report definitions, resume behavior, exclusions, and OCR-classification caveat |
| `scripts/audio_audit/audit_audio_headers.py` | Read-only WAV container/header and neighbouring-format inventory; calculates duration/encoding aggregates without decoding, copying, transcribing, or uploading audio |
| `scripts/audio_audit/run-audio-header-audit.ps1` | Normal-Windows launcher that reuses the authoritative corpus inventory and signed-in mapped-share access |
| `scripts/audio_audit/test_audio_audit.py` | Synthetic proof of header parsing, measurement-companion detection, duration calculation, and preservation of source size/timestamp |
| `scripts/audio_audit/build_audio_pilot_manifest.py` | Deterministically selects the bounded, representative 12-file WAV pilot without reading audio bodies or making an Azure call |
| `scripts/audio_audit/test_audio_pilot_manifest.py` | Proves the pilot covers the required format, duration, source, channel, speech-hint, and companion categories while remaining bounded and `pilot_only` |
| `scripts/audio_audit/prepare-audio-pilot-payload.ps1` | Normal-Windows staging launcher that hashes and copies only the selected WAVs into an ignored, dedicated build context while proving source size/timestamps remain unchanged |
| `scripts/audio_audit/README.md` | Audio-audit and bounded-pilot privacy boundary, operating commands, report definitions, and interpretation limits |
| `scripts/audio_ingestion/audio-pilot-contract.mjs` | Fail-closed payload, size, scope, source-ID, Blob-name, citation-namespace, and promotion-state validation shared by the private uploader |
| `scripts/audio_ingestion/upload-audio-pilot.mjs` | Temporary-job entrypoint that uses the explicit ingestion UAMI to upload originals and a private catalog, then verifies Blob metadata and authorized byte-range reads |
| `scripts/audio_ingestion/audio-pilot-contract.test.mjs` | Offline proof that pilot bounds, identifiers, permission scope, safe Blob paths, and non-promotion rules are enforced |
| `scripts/audio_ingestion/Dockerfile.audio-pilot` | Non-root disposable ingestion image; the normal-Windows launcher copies it with only the required code and selected private payload into the ignored build context |
| `scripts/pst_audit/MetadataOnlyXstFile.cs` | Metadata-only XstReader extension with a strict message-property whitelist plus runtime guards proving no body or attachment payload was loaded |
| `scripts/pst_audit/PstMetadataAudit.cs` | Read-only PST inventory engine for folder/message-header/recipient/date/size and attachment-name/type metadata, with local per-mailbox and combined reports |
| `scripts/pst_audit/build-pst-audit.ps1` | Reproducible local build against pinned XstReader/Roslyn copies, including a build-time payload-API guard and self-test |
| `scripts/pst_audit/run-pst-metadata-audit.ps1` | Normal-Windows launcher limited to Glen, Owen, and an optional Jim PST at the approved share root |
| `scripts/pst_audit/test_pst_audit_contract.py` | Offline regression checks for forbidden payload calls, runtime guards, narrow PST discovery, and ignored local reports |
| `scripts/pst_audit/README.md` | PST inventory privacy boundary, pinned parser choice, operating instructions, output definitions, and third-party-consent warning |
| `scripts/validation/phase1b-bootstrap.cjs` | Temporary private-network validation job entrypoint for the idempotent Phase 1B migration plus isolated Blob container/Search index creation |
| `scripts/validation/phase1b-validation-maintenance.cjs` | Private-environment audit, retrieval evaluation, and tightly scoped synthetic-fixture cleanup used during Phase 1B validation |
| `scripts/validation/phase1b-postgres-owner-recovery.cjs` | One-purpose cleanup utility that transfers bootstrap-created PostgreSQL object ownership to the permanent Entra administrator before deleting a temporary bootstrap principal |
| `scripts/deployment/set-consult-template.ps1` | Fail-closed zero-traffic helper requiring an immutable image, explicit Search index and Phase 1B/hybrid flags; it sets or removes complete model/embedding/semantic/readiness contracts, refuses v1 hybrid targeting and single-revision mode, and verifies zero traffic |
| `Dockerfile.validation` | Reproducible, non-root maintenance image used only under a temporary ACR tag for private-environment bootstrap and validation |
| `.github/workflows/phase1a-consult-build.yml` | Branch-scoped OIDC application build; an explicit `[validation-image]` commit marker additionally publishes the temporary maintenance tag without deploying it |
| `database/migrations/001_phase1b_consult.sql` | Backward-compatible Phase 1B schema with database-enforced same-owner folder, conversation, and attachment relationships; applied and validated in DEV |

Source PDFs, extracted payloads, Azure credentials, and temporary ingestion artifacts are
not committed to Git.

The committed uploader now fails closed on the current sixteen-document corpus count,
validates unique document/chunk identifiers and non-empty chunk sets, and can rebuild
the approved Blob/Search corpus from a page-preserving payload. Confidential source
PDFs and the operational payload remain deliberately uncommitted. A different approved
corpus size requires an explicit environment override; the override is a validation
mechanism, not authorization to ingest.

### Documentation

| Path | Responsibility |
| --- | --- |
| `docs/phase1b-consult-design.md` | This authoritative living reference |
| `docs/hybrid-retrieval-prompt.md` | Owner-approved focused build specification retained for traceability; this living reference remains authoritative for current state |
| `docs/helmonicpstmetadatainventoryprompt (1).md` | Owner-provided PST metadata-inventory scope retained verbatim for traceability |
| `docs/corpus-to-ingestion-plan.md` | Audit-backed October plan for manifest approval, staged async ingestion, Word rendering, OCR triage, scaled evaluation, and production gates |
| `docs/phase1a-tuesday-runtime-exception.md` | Focused historical/root-runtime exception and mandatory exit gate |
| `README.md` | Original product/frontend README; currently tracked for accuracy update |

## Decision log

### D-001: one consolidated repository and branch

All Phase 1A/1B work remains in `ahsanammar715-creator/Helmonic` on
`phase1a-consult-demo` and draft PR #16. No duplicate repository or uncoordinated
side-branch is approved.

### D-002: Container App-hosted UI is live; Vercel stays separate

The authenticated Container App serves both UI and API. This avoids two deployment
systems in the data path, cross-domain requests, an independently exposed API, and
Vercel authentication/backend integration. `helmonic.vercel.app` remains a public,
inert mock and is not permitted to call the Azure Consult API. CORS remains disabled.

### D-003: Target A and Target B remain distinct

- Target A: a model-generated answer grounded in permitted retrieved evidence with
  mandatory citations.
- Target B: retrieval-only evidence with citations and no generated summary.

Target B is proven and remains the safe fallback. It must never be presented as Target
A. Model unavailability cannot cause uncited generation.

### D-004: no-evidence rule

If permitted retrieval returns no adequate evidence, Consult says so explicitly. It
does not fabricate a source or treat general context as document evidence. If the user
has explicitly enabled D-022, visibly marked model knowledge may follow the mandatory
no-document-evidence statement; it never changes the document-evidence result.

### D-005: citations are server-authoritative

The server creates citation objects from Search results. The model can reference only
provided markers. The Sources panel displays real document/page evidence. Phase 1B adds
separate `D`, `A`, and `G` marker namespaces so controlled documents, conversation
attachments, and unverified model knowledge cannot be mistaken for one another.

Target A is fail-closed: the Model Gateway rejects an empty answer, missing or
unsupported document markers when evidence exists, malformed markers, and any `G`
marker unless the D-022 feature is explicitly enabled. When evidence is absent, it
rejects a fallback that omits the mandatory disclosure. It does not silently remove an
invalid marker or append a citation the model did not actually use.

### D-006: root/port-80 was a tracked temporary exception

The earlier Phase 1A revision temporarily ran as root so Next.js could bind the
app-wide port-80 target without invalidating the rollback path. On 26 August 2026 the
approved coordinated cutover moved ingress to port 8080 and 100% traffic to the
non-root `--p1b69b6b7a` revision. The root revision remains active at 0% only as a
short-term rollback option; it is not on the live request path. Full administrative
closure still requires deactivating every root-running revision when the rollback
window is deliberately closed.

### D-007: model choices for the current real-document path

- Microsoft now publishes the Azure Foundry deployment IDs `gpt-5.6-sol`,
  `gpt-5.6-terra`, and `gpt-5.6-luna` at version `2026-07-09`. They were not selected
  for this slice because quota, cost, and a separate deployment approval have not been
  completed; their later catalog availability does not retroactively authorize them.
- GPT-4.1 and GPT-4o were current dead ends for this subscription: the available paths
  were legacy/deprecating/provisioned and the subscription had zero usable provisioned
  quota.
- Phi-4 had observed Global Standard capacity, but not an approved Data Zone Standard
  path for the real confidential-document workload. It was not selected while the
  business/legal EU transfer question remained open.
- On 27 August 2026, live Azure APIs reported Mistral Large 3 version `1` with 20 kTPM
  of EU Data Zone Standard quota/capacity in France Central. The current Microsoft
  [lifecycle table](https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirement-schedule)
  marks the model Preview. Microsoft's
  [May 2026 DPA](https://www.microsoft.com/licensing/docs/view/microsoft-products-and-services-data-protection-addendum-dpa)
  does not use a
  narrower `regulated personal data` threshold for its Preview restriction: unless a
  Preview is expressly identified as allowing Personal Data processing, customers
  should not use it for any Personal Data. The controlled corpus contains professional
  names/signatures and one residential-address case, and no express Microsoft
  designation allowing Personal Data processing was found for Mistral Large 3.
  **Decision: Mistral Large 3 is removed as a Helmonic candidate model, not placed on
  hold.** It must not be deployed, routed to, or tested with the real corpus while its
  lifecycle remains Preview. It may be reconsidered only if Microsoft changes its
  lifecycle status to Generally Available; quota availability alone is insufficient.
- GPT-5.5 version `2026-04-24` Data Zone Standard is the intended primary path. On
  27 August 2026, live Azure APIs reported 333 kTPM of Data Zone Standard quota and
  deployable capacity in North Europe. Both Microsoft's lifecycle schedule and the
  [Foundry model catalog](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure)
  plus the live Azure model record classify this exact version as Generally Available, with
  inference retirement listed for 26 October 2027. GPT-5.5 is therefore the default
  primary candidate for real documents. No deployment is implied by quota availability;
  architecture, networking, token pricing, and validation retain separate approval gates.

### D-008: model requests were denied because of subscription classification

The GPT-5.5 and Mistral requests were not rejected because of the application design.
Microsoft identified the Free Trial subscription
classification and directed upgrade to PAYG before the quota path could proceed. The
subscription now reports `PayAsYouGo_2014-09-01`, Active/Paid billing, and spending
limit Off. Default quota appeared after the upgrade, so duplicate increase requests
were not submitted. This historical quota result does not restore Mistral candidacy;
the later Preview/DPA decision above controls.

### D-009: general context is additive and isolated (superseded)

The controlled-document answer remains primary. General context uses a separate source
set, model call, response object, UI block, and citation namespace. Live Bing grounding
stays disabled because Microsoft documents that its queries leave the Azure
compliance/Geo boundary. D-022 supersedes the separate-call and separate-UI parts of
this decision; the no-web-grounding boundary remains unchanged.

### D-010: brainstorming uploads are not controlled company sources

Conversation attachments go to a separate Blob container and Search index and are
filtered by owner and conversation. Promotion to the controlled knowledge base is
explicit, authorized, deduplicated, audited, and never automatic.

### D-011: cost approval is per action

No resource creation, SKU/scale change, model deployment, ingestion run, traffic shift,
or other potentially billable action occurs without a current estimate and explicit
approval. Uncertainty is resolved by asking rather than assuming.

### D-012: reuse the existing Helmonic UI and deployment path

The approved Next.js interface was containerized and extended in place. Phase 1A did not
replace it with a separate backend repository, a second frontend, or a generic Azure
sample application. Phase 1B continues to extend the same routes and components.

### D-013: interactive retrieval and ingestion have different privileges

The live runtime reads Search evidence; it is not a standing Search index administrator.
Phase 1A ingestion used a dedicated temporary identity with Blob/Search write roles and
removed that identity and its roles after the controlled operation. Phase 1B requires a
new, explicitly approved ongoing worker identity because end-user uploads are a durable
product capability, not another temporary bootstrap operation.

### D-014: private data-plane paths are preserved

Key Vault, PostgreSQL, Blob, and Search remain private-network dependencies reached from
the VNet-integrated Container Apps environment. Public access is not reopened for local
debugging or convenience. Service Bus Basic is the documented DEV exception: it uses a
public service endpoint protected with Entra/RBAC because a Premium upgrade was not
approved.

### D-015: application access uses two independent gates

Microsoft Entra sign-in is restricted to the two approved users, and Container Apps ingress
also applies the approved source-IP allowlist. These controls are app-wide and remain in
force across revisions. Neither control is replaced by an application-only login screen.

### D-016: controlled data changes are explicit and reversible

The first five and subsequent eleven approved PDFs produced a sixteen-document
controlled corpus. Originals and page-preserving chunks are retained through Blob and
Search. Temporary ingestion identities, roles, image repositories, and local payloads
are removed after approved one-shot work. Phase 1B must make the complete corpus
reproducible without committing confidential PDFs.

### D-017: no silent production hardening claims

The current DEV architecture proves the Phase 1A path, not production readiness. Search
has one replica/partition, PostgreSQL has no HA, Service Bus Basic is not private, ACR
network privacy is unproven, and the root runtime exception remains open. These facts
stay visible until separately designed, costed, implemented, and validated.

### D-018: close the runtime exception before upload implementation

The first Phase 1B code slice hardened the existing container boundary before adding a
document-write surface. Source and the live revision now use the built-in non-root
`node` user and port `8080`; owned runtime files, an automated Dockerfile invariant
check, and runtime UID evidence prevent the expired Tuesday exception from silently
returning. The older root revision is retained at 0% only as the explicitly approved
short-term rollback option.

### D-019: Phase 1B application contracts land disabled and permission-first

The first application slice is source-only and introduces no Azure mutation. Uploads,
folders, and general context each require an explicit feature flag. The schema uses the
authenticated Entra object ID as the ownership boundary and database-level composite
foreign keys prevent cross-owner folder/conversation/document relationships. Session
attachments use a separate Blob container and Search index, and retrieval filters on
both owner and conversation before results are shaped as `A` citations. Controlled
documents retain `D` citations; optional model knowledge uses `G` disclosure markers and never enters
the Sources panel. D-022 later reclassified `G` as an unverified model-knowledge marker
rather than a reference citation. The migration, session container/index, worker, feature activation,
deployment, and traffic shift remain separate cost/approval gates.

### D-020: every Container Apps revision uses an explicit immutable template

Revision creation must specify the immutable image SHA, Search index, and uploads,
folders, general-context, and hybrid feature flags together.
`scripts/deployment/set-consult-template.ps1`
enforces those inputs, refuses single-revision mode, and verifies that a newly created
revision receives zero traffic. Operators must not use an image-only or flag-only
update that silently inherits Azure's previous latest-revision template.

### D-021: reconcile the pilot diagram through a versioned hybrid retrieval cutover

The original Phase 1A pilot diagram is reconciled as follows. Its dashed out-of-scope
box remains correct and authorizes no Outlook/email, planning, tender, maps/travel,
lead-research, or automation work. The model layer has one provider only: the existing
GA GPT-5.5 Azure OpenAI deployment; the diagram's Claude branch is removed and no
Anthropic integration is permitted. The diagram's vector/hybrid/semantic Search layer
is the intended state, while live `consult-demo-v1` is lexical-only; that mismatch is a
retrieval defect to close, not behavior to preserve. The diagram's `8-15 documents`
label is also stale: the controlled corpus contains sixteen documents. At reconciliation
time no standing ingestion worker or embedding deployment existed; Actions are not live,
and MFA cannot be inferred from Container App authentication settings alone.

The selected implementation is `text-embedding-3-small` at 1,536 dimensions. Read-only
inventory on 28 August 2026 found that North Europe offers this model only as
`GlobalStandard`, while France Central and Sweden Central list `DataZoneStandard`.
Therefore the existing North Europe Foundry account cannot host the approved embedding
deployment type. After explicit approval, France Central quota was reconfirmed at 0 of
1,000 and the model record explicitly exposed version 1 as `DataZoneStandard`.
`aif-helmonic-embed-dev-001` and deployment
`text-embedding-3-small-helmonic-dev` were then created with public access disabled from
the initial resource PUT and reached through `pe-ai-embed-helmonic-dev-001` in the
existing DEV network. Controlled
chunks and questions use the same managed-identity embedding deployment. BM25 and
cosine HNSW execute as one hybrid query; `permission_scope` is applied through Search
`preFilter` before vector traversal/fusion. Semantic reranking is selected for the
primary relevance gate because Microsoft documents hybrid RRF score ranges as volatile.
Candidate semantic `2.0` and RRF `0.015` cutoffs live in the committed fixture and pure
policy; they are not approved for traffic until tuned against private v2 evaluation.
Missing scores and below-threshold results are discarded before citations are built, so
vector nearest-neighbour behavior cannot bypass D-004.

The zero-traffic generated-answer smoke exposed an evidence-projection defect, not a
model-arithmetic or Search-recall defect. Page 7 is ingested as one atomic table chunk:
its narrative supports a separate 7 dB recommended-level exceedance, while its appended
Table 6 contains the required 66 dB rating, 47 dB background, and 19 dB difference. The
chunk was already among the four retained citations, but the server converted every
Search result to a 420-character citation excerpt before sending evidence to GPT-5.5,
which removed the appended table values. The selected correction retrieves
`chunk_kind` with hybrid results and preserves a bounded 3,000-character excerpt only
for atomic table chunks; ordinary narrative stays capped at 420 characters. This keeps
the same top-four relevance gate, permission pre-filter, citation identity, and one
Search call. Increasing top-k or adding a second Search request is rejected because the
required chunk was already present. The lexical v1 path is unchanged.

Temporary validation jobs attach the standing ACR-pull UAMI and a disposable ingestion
UAMI at the same time. Application-side token acquisition must therefore never rely on
default identity discovery. The payload uploader and private evaluator require
`AZURE_CLIENT_ID` and construct `ManagedIdentityCredential` for that exact ingestion
identity; missing or blank configuration fails before any data-plane request. Image pull
continues to use the separately configured ACR identity at the Container Apps platform
layer.

Azure Search document writes can report success before every new document is visible to
a search query. The v2 uploader therefore polls the exact target manifest for a bounded
period after upload. It never weakens the 414-chunk/source/title/page parity requirement:
the job still fails closed if the complete manifest does not become visible within the
bounded window.

`consult-demo-v1` is immutable rollback. A separately created `consult-demo-v2` adds
the vector field, cosine HNSW profile, semantic configuration, and table metadata.
Re-ingestion must preserve declared tables as atomic Markdown or key/value chunks,
compute every vector before index creation, and prove source/chunk/title/page parity
against v1 and again against v2. Mutating v1 in place is rejected because it removes the
instant rollback boundary and vector field changes are unsafe to assume in-place.
Embeddings alone are rejected because exact numeric, unit, and standards references
need BM25. Claude as a second provider is rejected as outside the corrected diagram and
single-provider decision. No Azure index, deployment, ingestion, or cutover occurs
without D-011 approval.

### D-022: one flowing answer with visibly unverified general knowledge

D-009's split answer, second model call, curated general index, and dedicated UI block
are replaced by one existing GPT-5.5 call and one natural answer. Server-retrieved
controlled and attachment claims retain strict `[D#]` and `[A#]` validation. Optional
model-memory context uses sequential `[G#]` disclosure markers in the same paragraphs;
those markers are not citations, do not create source records, and never enter the
Sources panel. Whenever a `G` marker appears, the UI permanently displays: `[G] marks
the model's own general knowledge, not verified against your documents.` If no permitted
document evidence exists, the response must state that fact before any general fallback.
No web search, new index, second model call, or new data-egress path is introduced.

This reduces latency, cost, and the fragmented reading experience, but it accepts a
clear product risk: `[G]` content is not externally verified and can be wrong. The
feature therefore remains opt-in, flag-controlled, honestly uncertain when needed, and
disabled in live DEV until the hybrid-v2 runtime is separately approved and promoted.

### D-023: inventory and quality-gate the full corpus before ingestion

The approximately 300 GB company collection is not treated as one approved upload batch.
A read-only, resumable local audit must first count formats by checklist area, verify PDF
and Word structure, identify byte-identical duplicates, list possible filename variants,
and measure full/partial OCR candidates. No extracted text is retained in audit reports,
and the source share is never written to. `backup_glen`, `backup_owen`, `Book Directory`,
`downloads_helmonic_smart_studio`, and `Tender Desk` are excluded; the checklist document
is reference-only. `IA-02.1` and `IA-02.2` jointly represent `IA-02`; `IA-21` remains
explicitly unmapped pending human classification. Approved books/IOA material and
third-party reports remain eligible, while Cadna/specialist material is classified
against the raw-data/calculation categories rather than guessed into an ingestion batch.

OCR procurement is decided only from the completed page-level audit and a human spot
check of candidates, because low-text drawings and blank pages can resemble scans. Word
files are intended to render to PDF before extraction so page citations remain consistent;
a file that cannot render faithfully will be flagged and skipped. Human owners still set
business-value priority. A well-tested, high-value majority is preferred to a rushed full
corpus. No Azure resource, index write, document upload, or OCR service is authorized by
the inventory itself.

### D-024: PST discovery is metadata-only and separate from document ingestion

The Glen and Owen PST archives, plus Jim's archive when it is actually present, are a
separate discovery track from D-023. The selected parser is the open-source XstReader
C# library pinned to commit `3b7856c8b3d01bdf8aa13744e476d1ef7761b832` and used
directly against each PST with read-only file access. Outlook automation was rejected
because attaching a PST through Outlook changes the user's active profile; no profile
or mailbox application is opened by this audit.

The permitted field set is folder names/counts, message class, subject, sender,
recipients, timestamps, PST/message declared sizes, and attachment count/name/type/
declared size. Email bodies, HTML/RTF payloads, full property dumps, attachment content,
exports, OCR, and Azure transfer are prohibited. Build-time forbidden-call checks and
runtime body/attachment-content assertions fail closed if that boundary is crossed.
Reports contain personal metadata and remain under ignored `local-artifacts/pst-audit`.

Mailbox owners' awareness does not settle consent or another lawful basis for other
people represented in the correspondence. That third-party question remains visibly
open. This metadata inventory grants no authority for full body or attachment-content
extraction, indexing, model processing, or ingestion. Jim's missing PST is a pending
input, not an error and not a reason to delay Glen and Owen.

### D-025: scale the controlled corpus through approved manifests and quality gates

The 2 September all-page audit is internally consistent enough for planning: all eleven
reconciliation/safety checks pass. Although the full discovery collection is 29,703
files/286.9 GB, the October PDF/Word scope is 2,633 documents/6.79 GB. After integrity
checks and exact deduplication, 2,217 unique documents are technically ready; after
holding unresolved IA-21/Cadna identities and three duplicates that cross those
boundaries, the conservative starting pool is 2,064 unique documents: 1,779 readable
PDFs and 285 Word render candidates.

This count is technical eligibility, not business approval. Acoustic owners must rank
the first 100-document pilot and supply/confirm evaluation answers. Ingestion consumes
an owner-approved manifest rather than crawling the share. It then scales readable PDFs
in 250–400-document candidate batches, adds Word only through validated PDF rendering,
and holds broad OCR until human review establishes whether priority evidence needs it.
Each batch remains outside live retrieval until source/hash/chunk/vector parity,
permission filtering, citations, numeric/table accuracy, no-evidence behavior, and a
proportional expert evaluation pass.

The permanent Service Bus worker, standing least-privilege identity, malware policy,
capacity changes, material embedding/indexing calls, and any production resource or
cutover remain D-011 cost/approval gates. This decision authorizes only local planning
and analysis. The source snapshot must be refreshed before materializing a manifest.

### D-026: capture the complete approved corpus; expose it progressively

The owner clarified that 2,064 documents are the first dependable searchable wave, not
the final Helmonic boundary. Every one of the 29,703 audited approved files/286.9 GB is
now an original-capture and metadata-catalogue target. Raw bytes are not automatically
language-model evidence: PDFs/Word, OCR, text/tables, acoustic measurements, media,
images, design models, archives, and future email material use separate processing
lanes. Search exposure remains permission-first, canonical-versioned, relevance-tested,
and staged outside the live index.

The ignored local intake manifest reconciles every audited file/byte, marks every
original for capture, holds three cross-category duplicate families, and reproduces the
2,064 canonical first-search candidates. All 29,703 permission scopes intentionally
remain unset until assigned; full capture must never become accidental universal Search
access.

Evidence namespaces are source-specific. Project documents use numbered `D` citations,
standards use numbered `S` citations, emails use numbered `E` citations, email
attachments use numbered `A` citations, and audio uses timestamped `AU` citations.
Approved books/reference uploads use display
marker `[B]` without exposing the title in the ordinary answer, while retaining the true
source identity in the private audit record. `[G]` remains visibly unverified model
knowledge under D-022 and is never represented as retrieved company evidence. Future
report generation and automation consume this same cited evidence layer only after the
ingestion foundation is stable.

### D-027: classify audio locally before assigning it an AI role

The corpus contains 3,512 WAV files/204.0 decimal GB, concentrated in IA-02.2 and IA-06.
Existing path metadata shows that most live beside acoustic measurement or text-export
formats, while only two filenames contain a speech/voice hint. This supports—but does not
prove—the hypothesis that the collection is predominantly environmental/measurement
audio rather than meetings or dictated notes.

Before transcription, acoustic feature extraction, or audio-model processing is costed,
a read-only header audit records WAVE container, codec tag, channels, sample rate, bit
depth, declared data length, duration, and neighbouring format signals. It creates a
deterministic human-review list but never decodes or copies audio. Environmental audio
remains preserved and project-linked supporting evidence; only confirmed spoken material
becomes a transcription candidate. Future audio evidence uses timestamped `AU` citations,
and exact acoustic values require the associated calibrated measurement record rather
than inference from an ordinary WAV alone.

### D-028: retain WAV recordings as citable project evidence

After reviewing the completed header audit, Jim confirmed that the approved audio
recordings should enter Helmonic for reference. All 3,512 WAV originals therefore remain
in the capture-all manifest, receive the `AU` citation namespace, and will be linked to
the associated project, report, measurement exports, and available recording metadata.
Consult may cite the exact relevant interval as `[AU#, hh:mm:ss-hh:mm:ss]` and offer
controlled playback. Audio is supporting evidence rather than a default retrieval
corpus: no broad transcription is authorized, and authoritative acoustic levels require
the calibrated measurement record rather than model inference from raw audio.

The 204.0 GB Blob upload, any playback endpoint, waveform/event analysis, transcription,
or model processing remain separate D-011 cost and implementation gates. This decision
changes the target architecture and local manifest only; it does not authorize an Azure
upload or live application change.

Delivery is staged for the production timeline. A deterministic 12-file pilot, capped
at 512 MiB, must cover both source groups, the observed format tags and duration bands,
multichannel recordings, filename speech hints, and the available measurement/PDF/text
companion cases. It remains `pilot_only` until source hashes, private Blob retention,
project linkage, authorized byte-range playback, and timestamped `AU` citations pass.
Format-tag-17 recordings require a controlled playback derivative unless compatibility
is independently proven. Bulk batches require a separate approval after this gate; the
pilot performs no transcription or model processing.

The twelve-file private Azure pilot subsequently passed in the existing VNet-integrated
Container Apps environment. All selected originals and the private project-link catalog
were stored in `consult-controlled-audio`; stored length/hash metadata and authorized
WAVE byte-range reads were verified. The disposable job, data UAMI, Blob role, ACR
repository, and repository-scoped deletion grant were then deleted and independently
confirmed absent. The retained Blob objects remain `pilot_only`, `iAcoustics`-scoped,
`AU`-namespaced, and untranscribed; this pilot did not change Search, a model, an app
revision, or live traffic.

The future inline `[AU#, start-end]` player is sequenced with the next bounded audio
batch, after the standing ingestion identity and without competing with the first
100-document batch. A browser must not receive a private Blob URL or a broad SAS: the
native HTML5 audio element will call a same-origin BFF endpoint that repeats the current
user/project permission check and supports byte ranges. Native compatibility with the
dominant WAV format-tag-17 material must be proven; incompatible files use controlled
playback derivatives while originals remain authoritative. No player endpoint, playback
derivative, transcription, or audio analysis is included in the identity proof.

### D-029: prove a standing least-privilege ingestion identity before scaling

The recurring document and audio pipeline now uses persistent UAMI
`uami-helmonic-ingestion-001` instead of paying the identity-creation and propagation
delay on every batch. It has exactly three current Azure data-plane assignments:
`Storage Blob Data Contributor` on `sthelmonicdev001`, `Search Index Data Contributor`
on `srch-helmonic-dev-001`, and `Cognitive Services OpenAI User` on
`aif-helmonic-embed-dev-001`. It has no Owner, resource Contributor, Search service
administration, model administration, Service Bus, or PostgreSQL role. Service Bus and
database rights remain future resource-specific gates rather than guessed permissions.

The identity was proven through a disposable job in the existing VNet-integrated
environment. Using its client ID explicitly, the job uploaded, read back, hashed, and
deleted one synthetic object in `consult-session-uploads`; requested one valid
1,536-dimensional embedding; wrote, queried, and deleted one synthetic record in
`consult-session-v1`; and used no real company content. The execution succeeded only
after its cleanup checks passed. The disposable job and proof image repository were
deleted, including both proof manifests, and the repository-scoped cleanup grant was
revoked. The standing identity and its three roles deliberately remain. The established
temporary-identity code path also remains available as a fallback until the first real
batch proves the standing path under normal workload.

### D-030: isolate the first 100-document standing-identity batch

The first scaled document run targets candidate index `consult-candidate-pilot-100-v1`
and Blob prefix `consult-sources/controlled-corpus/corpus-pilot-100-v1/`; neither is
referenced by the live Container App. Its standing UAMI is selected explicitly by client
ID and retains only the three D-029 roles. Index schema creation remains a separate
operator action because the worker intentionally lacks Search service-administration
permission.

Until the acoustic consultants return their ranked sources and known-answer set, the
batch is a non-promotable pipeline validation. Selection is deterministic and balanced
across nine already-approved project/report categories: exactly 100 canonical,
text-extractable PDFs, excluding books, OCR candidates, duplicate copies, Word rendering,
broken files, and IA-21/Cadna holds. Every selected file must match its audit size and
timestamp, remain stable while its capture SHA-256 is calculated, preserve every readable
page and detected table, and receive internal `iAcoustics` scope plus the `D` citation
namespace.

The job refuses live/rollback index names, requires the candidate schema to pre-exist,
proves the candidate's vector dimension and permission filter through a document-level
search probe permitted by `Search Index Data Contributor` (rather than reading the index
definition with a service-administration role),
re-verifies every staged original hash, uploads and reads back opaque Blob names, embeds every chunk,
requires exact source/chunk/vector parity, and runs six distributed hybrid source probes
plus positive and negative permission checks. These automated probes validate plumbing;
they do not replace the pending 15–20 consultant-authored acoustic questions. Codex can
read the private audit outputs but the sandbox cannot open company-share file bodies, so
the source-preserving payload must be staged once from the normal signed-in PowerShell
session before the approved Azure run can begin.

### D-031: make bounded, resumable two-reader verification standing policy

Document extraction now runs one source per child process with a default ten-minute and
2 GiB working-set ceiling. Crossing either limit terminates only that document worker,
marks the source for manual review, removes its partial staged copy, and prevents the
candidate payload from being treated as complete. Each successful result is written
atomically to a source-ID checkpoint and its staged SHA-256 is rechecked on resume, so a
stopped batch resumes completed work without trusting a changed or incomplete artifact.
The private summary records measured per-document elapsed time plus median, p95, and
maximum peak memory; Azure ingestion retains its own embedding/Search totals so the next
batch can be sized from the pilot's measured time, memory, and cost per document.

Every PDF is verified by both pdfminer/pdfplumber and pypdf as part of the normal path,
not only after a visible warning. Both reader passes must open every audited page; a
legitimate blank, drawing, or image-only page is recorded rather than treated as invented text. A recoverable
stream warning can be classified `repair_verified` only when those completeness checks
pass; a page-count mismatch, unreadable page, unresolved second-reader failure, hash mismatch,
timeout, or memory breach is quarantined. No OCR or invented replacement content is
allowed. This policy applies to every future document batch. The Word lane remains
excluded until its separate rendering-fidelity gate has passed.

## Current status

### Live and working

- Hybrid v2 revision `--hyb570514c` receives 100% of live traffic through application
  ingress port 8080. It uses immutable image
  `helmonic-consult:570514ca8733453dbd98ad0c32ecc6bbd69a8912`, targets
  `consult-demo-v2`, runs as UID 1000, and keeps minimum replicas at zero.
- The prior Target A revision `--p1bgpt55fin` remains active at 0% as the immediate
  `consult-demo-v1` rollback. The 10% -> 25% -> 50% -> 100% cutover completed without
  5xx responses, restarts, sustained latency regression, citation failure, or an
  unexpected no-evidence response.
- The prior hardened revision `--p1b69b6b7a` remains active at 0% as the immediate
  Target B rollback. The older root/port-80 revision and placeholder remain available;
  a rollback to `--ca72a0c` must restore ingress port 80 as well as its traffic weight.
- Commit `1dad41d` passed GitHub CI, immutable ACR image build, and Vercel Preview. The
  100-PDF private payload has passed its bounded two-reader gate and candidate index
  `consult-candidate-pilot-100-v1` now exists. Its single-purpose schema job used a
  temporary system identity and Search schema role; both were deleted and independently
  confirmed absent. The first standing-identity execution stopped at its opening schema
  lookup with HTTP 403 before any embedding, Blob, or Search document write because that
  lookup required a deliberately absent service-administration role. The preflight now
  proves the same candidate vector/filter contract through permitted document-data
  operations; live `consult-demo-v2` and traffic remain unchanged while the corrected
  private rerun is prepared. That corrected execution passed the candidate preflight and
  completed 1,537,291 embedding input tokens before its first Blob upload exposed an
  invalid metadata-name bug and failed with HTTP 400; it made no Search document write.
  Blob upload/read-back validation now precedes paid embeddings, uses Azure-safe metadata
  names, refuses overwrite, and accepts an existing object only after its length and
  controlled metadata match exactly. The corrected immutable `b3110b4` execution then
  passed: 100/100 documents, 2,631/2,631 chunks and vectors, 1,536 dimensions, exact
  manifest parity, six distributed source probes, permitted-scope visibility, and denied-
  scope isolation. This is 100/2,064 eligible unique documents validated in the candidate
  lane (4.8%); the separate live sixteen are not assumed additive until source identity
  reconciliation proves whether they overlap. The candidate remains non-promotable until
  consultant-authored known-answer evaluation arrives.
- Platform authentication is enabled and restricted to exactly Ammar Ahsan
  (`c34341a3-7783-44d7-8980-b6ea8111bc06`) and Jim Dunne
  (`84889a68-5ca1-40d6-860b-7654b6f100ce`).
- The source-IP allowlist is active for `86.43.74.56/32`.
- The user has successfully signed in and reached the application.
- CORS is disabled and Vercel is outside the real data path.
- Sixteen controlled iAcoustics PDFs have been ingested.
- Blob originals and page-preserving Search chunks exist.
- `consult-demo-v2` hybrid/semantic retrieval is live and returns document/page citations.
- `consult-demo-v1` remains available through the retained rollback revision.
- The original five-case lexical suite passes against live Azure Search: four
  known-evidence questions return only the expected Harold's Cross, Premier Inn, and
  Wetherspoon's Camden Street evidence, while the France question correctly returns no
  permitted evidence. The Wetherspoon case specifically confirms the former unrelated
  Premier Inn relevance leak is closed for those named-project cases. It does not prove
  paraphrase recall or vector-safe no-evidence behavior; D-021 owns that remaining gap.
- The Sources panel displays retrieved passages.
- The no-evidence response is implemented.
- Generated-answer Target A is live through the provider-neutral Model Gateway using
  GA GPT-5.5 `2026-04-24`, Data Zone Standard, high reasoning, and a 2,000-token hard
  completion ceiling. Retrieval-only Target B remains available through the retained
  rollback revision.
- The live generated-answer path passed the five-case private suite: four known-evidence
  questions produced grounded answers with only valid document/page markers and the
  France question returned the fail-closed no-evidence result with no answer or citations.
- A separate known-evidence smoke query returned four Harold's Cross citations and the
  no-evidence smoke query did not invoke the model. `/healthz` and `/readyz` return 200
  on the live revision; `/healthz` reports UID 1000 and `nonRoot: true`.
- Managed-identity connectivity/readiness is implemented for the Azure runtime path.
- PostgreSQL managed-identity login and least-privilege foundation are proven.
- GitHub OIDC builds immutable `helmonic-consult:<commit-sha>` images in ACR.
- Temporary ingestion/bootstrap identities and their roles were removed after use.
- `README.md` now points to this living reference and accurately separates the live
  Phase 1A Consult runtime from the remaining mock workspaces.
- Documentation parity, the retrieval fixes, and the Target A Model Gateway are pushed
  on PR #16 through `78f31b9`; GitHub CI, the immutable ACR build, and Vercel Preview
  checks are green for the deployed image.
- The first Phase 1B local slice implements the non-root/port-8080 source image,
  automated hardening guard, and `/healthz` runtime-user evidence.
- Before cutover, hardened revision `--p1b69b6b7a` was deployed at 0% traffic with
  minimum replicas 0 and returned to 0 running replicas after validation. Console validation
  on 26 August 2026 proved UID `1000`, `/healthz` 200
  with `nonRoot: true` and the exact `69b6b7a...` version, and `/readyz` 200 against
  the inherited managed-identity/private-service configuration.
- The temporary `p1b-validate` label used for console validation was removed. After the
  coordinated cutover, the authenticated live UI rendered successfully and a live
  sound-insulation query returned four server-verified passages in the Sources panel,
  including the real document title and page for every passage.
- Local runtime-invariant verification, generated route types, full TypeScript, lint,
  and application compilation pass. This Windows sandbox blocks Next.js child-process
  workers with `spawn EPERM`, so CI remains the authority for the final build/E2E pass.
- The Phase 1B migration is now applied in DEV: all nine owner-scoped tables exist and
  all nine expose the intended runtime CRUD grants. The isolated
  `consult-session-uploads` Blob container and `consult-session-v1` Search index also
  exist on the already-approved services.
- Zero-traffic revision `--p1be20378e` proved UID 1000, `/healthz` 200, `/readyz` 200,
  authenticated folder/subfolder persistence, and a real 121-byte synthetic PDF path
  through PostgreSQL, Blob, and Service Bus to the expected `queued` state. The worker
  boundary remains intentionally unimplemented. The synthetic Blob/message/database
  rows were deleted and the revision was deactivated at 0 replicas/0% traffic.
- The read-only all-page corpus audit completed against the mapped company share without
  modifying it and without filesystem scan errors. It examined 29,703 files/286.9 GB,
  including 2,308 PDFs and 325 Word files. It identified 21 unreadable/broken documents,
  zero encrypted documents, 197 strong OCR candidates, 50 partial OCR candidates, 134
  exact duplicate groups containing 147 extra copies, and 332 possible filename-variant
  groups. The five exclusions and combined IA-02 mapping were applied as approved.

### Implemented in source; Azure foundation validation completed

- Phase 1B feature flags default off, preserving the current Azure revision and the
  Vercel fail-closed boundary.
- The backward-compatible PostgreSQL migration and transactional repository define
  owner-scoped folders, conversations, session documents, versions, ingestion jobs,
  messages, citations, and audit events. Database-level composite foreign keys prevent
  cross-owner folder, conversation, and document links.
- The Consult attachment UI now passes real PDF bytes to a same-origin API. The API
  validates size/type/PDF signature, writes owner/conversation metadata, streams to the
  isolated session Blob container with managed identity, hashes the content, and sends
  a versioned ingestion message to Service Bus.
- A separate session Search schema and owner/conversation-filtered retrieval path are
  defined. Controlled results use `D` markers and attachments use `A` markers.
- The provider-neutral Model Gateway now supports one feature-gated flowing answer:
  server-validated `D`/`A` document markers and explicitly unverified sequential `G`
  markers share prose, while the controlled Sources panel remains document-only.
- The prior separate general-context response block and component are removed. A
  persistent one-line disclosure appears only when the answer actually contains a `G`
  marker. Six offline policy tests cover fully grounded, blended, general-only,
  no-evidence, malformed, and honest-uncertainty behavior.
- The document-answer route now invokes the provider-neutral Model Gateway rather than a
  provider function directly. Its Azure GPT implementation uses managed identity, high
  reasoning, a 2,000-token reasoning/output ceiling, strict marker validation, and
  content-free token/citation telemetry. The five-case generated-answer evaluator passes
  both its offline policy contract and the private live Target A path.
- The migration, isolated Blob container, and session Search index are now applied in
  DEV. The session-upload worker, Azure Speech resource, sidebar activation, upload
  activation, and general-context activation remain unimplemented or disabled; the
  separately approved Target A model path is the only newly activated Phase 1B feature.
- D-021 hybrid retrieval is now live. Healthy revision
  `--hyb570514c` uses immutable image `570514c...`, `consult-demo-v2`, hybrid/semantic
  retrieval, minimum replicas zero, and disabled general context/uploads/folders. Its
  full eight-case live suite passed: both paraphrases, both Wetherspoon regressions,
  all three out-of-scope no-evidence cases with zero sources, and the unauthorized
  permission-scope pre-filter case. The disposable scope probe is inactive, temporary
  callbacks are removed, the stored next-revision template remains on the authorized v2
  configuration, and live traffic is 100% on `--hyb570514c`/v2. The prior
  `--p1bgpt55fin`/v1 revision remains active at 0% for immediate rollback and may be
  retired only after the owner accepts the completed observation window.
  The temporary job, ingestion UAMI, five roles, ACR repository/grant, Cloud Shell
  source, and local credential bundle were deleted after validation; the embedding
  deployment was restored to 1 kTPM. Earlier failed promotion attempts and their exact
  diagnoses remain preserved in the decision log rather than the current-state section.

### Pending/blocking

- The runtime-hardening slice is pushed, built, validated, and live. Deactivating the
  old root revision remains pending until the explicitly retained rollback window closes.
- Read-only subscription verification on 27 August 2026 reports quota ID
  `PayAsYouGo_2014-09-01`, subscription/billing status Active/Paid, and spending limit
  Off.
- GPT-5.5 `2026-04-24` is deployed as GA Data Zone Standard in North Europe under
  deployment name `gpt-5-5-helmonic-dev`, with a 10 kTPM rate limit, and is serving the
  live Target A application path.
- Private endpoint `pe-ai-helmonic-dev-001` is approved at `10.36.1.8`; private zone
  `privatelink.cognitiveservices.azure.com` is linked to the DEV VNet. Public access on
  the Foundry account remains disabled, and the Container App system identity has
  `Cognitive Services OpenAI User` scoped only to that account.
- Target A generated answers are live after immutable-image, zero-traffic, health,
  readiness, grounding/citation, no-evidence, and five-case generated-answer validation.
  Target B remains retained at 0% for rollback.
- GPT-5.5 Data Zone Standard retains 323 kTPM unallocated quota after assigning 10 kTPM
  to Helmonic. Mistral's
  observed 20 kTPM capacity is historical inventory information only; it is not an
  approved or active pathway and must not be revisited unless its lifecycle becomes GA.
- Phase 1B persistence/upload/general-context contracts are in source, and the migration
  plus isolated session container/index are applied. The standing ingestion UAMI and its
  three least-privilege roles are now independently proven with synthetic Blob,
  embedding, and isolated Search operations. The durable queue worker, sidebar tree
  activation, live feature flags, and any traffic shift remain pending separate approval;
  the temporary-identity path remains available as fallback.
  Voice deployment is no longer account-tier-blocked, but Azure Speech resource creation
  remains pending a separate cost estimate and approval.
- Azure Speech has not been provisioned.
- The approximately 300 GB corpus has not been ingested. Its read-only audit is complete:
  approximately 7.5% of PDF/Word files are strong OCR candidates and another 1.9% are
  partial candidates before human false-positive review. The 2,057 text-extractable PDFs
  and 306 readable modern Word files form the initial technical candidate pool, subject
  to deduplication, Word-to-PDF render validation, human business priority, permission
  checks, and the standing batch-quality gate. Raw/proprietary measurement formats are
  not silently treated as RAG documents.
- The D-025/D-026 local ingestion plan and private capture-all manifest are complete and
  independently recalculable from the audit outputs. The manifest accounts for all
  29,703 audited approved originals/286.9 GB across format lanes and identifies a
  conservative 2,064-document first searchable population. All permission scopes remain
  fail-closed. The first 100-PDF candidate batch is explicitly approved under a roughly
  USD 5 ceiling and has been staged locally as 100 documents/1,871 pages/2,631 chunks,
  but no Blob, embedding, Search, image, job, or candidate-index write has started. Its
  independent two-reader pass now covers all 100 documents and reconciles exactly 1,871
  pages: 87 are directly verified and 13 are repair-verified after tolerant-reader
  recovery or corrected trailing-page accounting. The bounded/checkpointed worker and
  Azure fail-closed verification contract are locally tested. Canonical-version, IA-21/Cadna, permission,
  malware, retention, and promotion-authority decisions remain pending. The more specific file
  `helmoniccorpustoingestionplanprompt.md` remains unavailable to the isolated agent and
  must be reconciled if it adds requirements beyond the accessible October brief.
- The D-027 normal-Windows WAV header audit completed all 3,512 files with zero header
  errors and proved source size/timestamps unchanged. The collection represents about
  4,565.7 hours/190.2 days: median duration two minutes, 90th percentile one hour, and
  99th percentile twelve hours. Most files are mono 24 kHz 4-bit format-tag-17 audio and
  1,253 have acoustic-measurement companions, strongly supporting a monitoring-audio
  interpretation. Two tiny compound-name `VoiceNote` files were identified after fixing
  the local filename classifier; headers still cannot prove speech content. Jim has now
  approved retaining the WAV originals in Helmonic as linked supporting evidence, using
  timestamped `AU` citations and controlled playback. The local manifest and design
  reflect that decision. The 12 representative files totalling 8,485,614 bytes were
  uploaded into the private `consult-controlled-audio` pilot path and passed stored
  length/hash plus authorized WAVE byte-range checks. They remain `pilot_only` and
  untranscribed, and no audio was decoded, played, interpreted, indexed, or sent to a
  model. The larger capture and inline-player work remain separately gated.
- The separate PST metadata-only audit ran from the user's signed-in PowerShell session
  and produced partial Glen/Owen reports. It recorded 44,568 email items and 141,518
  attachment metadata entries across the readable portion, but the run is not an
  authoritative final inventory: 3,416 Glen items lost access when the mapped PST path
  became unavailable, and 13,251 Owen items could not be read because another process
  held the PST. Five additional Glen path-character errors and one Glen network error
  were retained. Jim's PST was absent. The audit still read no bodies or attachment
  payloads and made no Azure call. A clean rerun requires stable share access and the
  Owen PST to be closed by every other process.
- No live-web connector has been approved. The inline general-knowledge source contract
  is implemented locally behind `HELMONIC_GENERAL_CONTEXT_ENABLED=false`; no live
  revision, flag, Search-index, resource, or traffic change has been made for it.
- The D-011 gate was approved for the approximately USD 7.80/month embedding private
  endpoint and a USD 0.30 private re-index/evaluation ceiling. The France Central account,
  Data Zone deployment, dedicated OpenAI private DNS zone/VNet link, and account-scoped
  runtime role are provisioned. `consult-demo-v2` passed exact corpus/vector parity and
  all eight private retrieval cases. Every disposable validation resource and credential
  was removed afterward. Changing `AZURE_SEARCH_INDEX` or live traffic still requires a
  new explicit approval.

### Tracked technical debt and risks

- The root/port-80 revision is no longer on the live request path, but remains active at
  0% as an intentional rollback option. Full exception closure requires deactivation.
- The application copy now uses one centralized sixteen-document corpus constant. It
  will need to move to server-provided corpus metadata when arbitrary controlled-source
  administration is introduced.
- The original five-case retrieval set guards named-project relevance and basic
  no-evidence behavior. The live runtime uses `searchMode: all` across title, section,
  and content so a missing project term cannot match only generic question words. The
  26 August live evaluation found a blocking serialization defect before rollout: the
  Search REST API expects `searchFields` as one comma-separated primitive string. The
  first 27 August private rerun proved that serialization was fixed but returned zero
  results for all three expected-evidence questions because raw interrogative/filler
  terms were still required by `searchMode: all`; both no-evidence cases passed. Source
  runtime now normalizes questions to their content-bearing terms while preserving the
  permission filter and `all`-term precision. Validation image `9117dfa` passed the
  corrected five-case private suite on 27 August: four expected-evidence cases returned
  their correct projects and the no-evidence case behaved as expected. That lexical
  regression is closed, but paraphrased technical questions remain a tracked live gap.
  D-021 replaces the fixture locally with eight reviewable paraphrase, regression,
  numeric-table, out-of-scope, and permission cases plus explicit score cutoffs. The
  broader gap moves to Resolved only after private v2 tuning, parity, generated-answer
  validation, and approved cutover pass; no traffic promotion is implied by source code.
- Azure's stored next-revision template now explicitly references immutable image
  `69b6b7af9283657c9f509385fcb2050ab01c65c4` with uploads, folders, and general context
  disabled. Validation revision `--p1btmpl69b6` was Healthy at 0% and then deactivated;
  live traffic remained 100% on `--p1b69b6b7a`.
- Temporary retrieval job `caj-helmonic-ret-eval`, identity
  `uami-helmonic-ret-eval-001`, and its Search role were deleted after validation. The
  temporary `validation-4316906...` and `validation-9117dfa...` ACR tags were deleted
  through short-lived repository-scoped Contributor grants, and both grants were revoked.
  The SHA-named immutable build images remain as normal branch build artifacts.
- Conversation messages and Recent sidebar items are not yet wired to the local
  persistence contracts.
- The web upload path is implemented, but no queue receiver/page-extraction worker is
  implemented or deployed; queued documents cannot become `ready` yet.
- The controlled uploader now enforces exactly sixteen documents by default. The
  confidential PDF/payload manifest remains an operator-controlled artifact rather than
  repository content.
- No ongoing ingestion worker/receiver is deployed.
- Service Bus Basic uses a public service endpoint with Entra/RBAC; Premium/private
  networking is not approved for this phase.
- ACR managed-identity image pull is proven, but an ACR private endpoint is not.
- PostgreSQL DEV is burstable and lacks production HA/restore hardening.
- Search Basic has one replica/partition and is not a production-resilience design.
- Password authentication remains available on PostgreSQL as a controlled fallback.
- Session retention, malware scanning, promotion authority, and approved general-source
  domains require decisions before Phase 1B Azure enablement.

### Cost status

The combined Phase 1B validation remained within the approved USD 0.32 hard ceiling.
It used only short-lived minimum-size Container Apps executions, existing service
transactions, and GitHub-hosted image builds; it introduced no new standing SKU,
minimum scale, or live traffic. After PAYG, the existing DEV baseline was estimated at
approximately USD 130-145 per month before model usage. Phase 1B incremental estimates
and approval gates are recorded later in this document.

The D-021 hybrid retrieval source implementation, fixture inspection, and local tests
cost USD 0. Read-only inventory found no North Europe
`DataZoneStandard` deployment for the selected embedding model; France Central and
Sweden Central list it. The owner approved France Central creation with approximately
USD 7.80/month for one additional private endpoint and its dedicated private DNS zone
(plus negligible data processing),
USD 0 standing model/account charge, no new fixed Search charge, and a USD 0.30 ceiling
for initial embedding, re-index, Search, storage, and short-lived job validation. The
account/deployment/private endpoint now exist. After private networking and explicit
multi-UAMI selection were corrected, the final private run embedded and indexed the full
sixteen-document/414-chunk corpus, passed exact v1/v2 metadata parity, and passed all eight
retrieval cases. The temporary 100 kTPM validation limit was restored to 1 kTPM and every
disposable job, identity, role, image repository, grant, source folder, and credential was
removed. Generated-answer evaluation against v2, a runtime revision, `AZURE_SEARCH_INDEX`
cutover, and traffic movement remain later, separately estimated and approved gates.
The same-page table-completeness correction and its full local test suite cost USD 0.
Building and revalidating it in Azure remain a separate approval gate; no Azure call or
standing-resource change was made during local diagnosis.

## Implementation and operations chronology

| Date | Evidence/change | Result |
| --- | --- | --- |
| 2026-08-21 | `9536a64` - Build Phase 1A Consult runtime slice | Added the Next.js API/runtime configuration, managed-identity clients, retrieval types/UI, readiness endpoints, container packaging, and controlled ingestion framework |
| 2026-08-21 | `9601511` - Add branch-scoped ACR image build | Added GitHub OIDC and immutable `helmonic-consult:<sha>` publishing on the approved branch |
| 2026-08-21 | `ccbc89b` - Fix Vercel packaging and Consult smoke assertion | Preserved normal Vercel packaging while using standalone output for Container Apps; corrected fail-closed E2E expectations |
| 2026-08-21 | `aa7addf` - Allow non-root runtime to bind port 80 | Attempted a non-root port-80 capability path; it did not work in Container Apps and was not treated as proven |
| 2026-08-21 | `ca72a0c` - Track Tuesday-only root runtime exception | Recorded and labelled the protected, temporary root/port-80 demo image plus the mandatory exit gate |
| 2026-08-24 | Entra/Container Apps operational configuration | Created the approved app registration, restricted sign-in to the approved user, applied the source-IP allowlist, and left CORS disabled |
| 2026-08-25 | Controlled ingestion and traffic operations | Routed the validated real revision to 100%, retained rollback, extended the controlled corpus from five to sixteen PDFs, verified retrieval/citations, and removed temporary ingestion access/artifacts |
| 2026-08-25 | Model/quota verification | Confirmed Target B works; no approved model had usable EU Data Zone quota. GPT-5.5 and Mistral quota requests were denied because the subscription remained Free Trial |
| 2026-08-26 | `00bd81f` - Documentation parity audit and push | Created this living reference, corrected stale CORS and README claims, mapped every tracked file, recorded the five-vs-sixteen ingestion reproducibility gap, pushed the commit, and synchronized PR #16 |
| 2026-08-26 | Azure traffic/stale-tab diagnosis | Portal reconfirmed `--ca72a0c` at 100% and `--0000001` at 0%; browser history proved the Hello World tab was an unreloaded document first opened on 25 August, not a current traffic split |
| 2026-08-26 | Phase 1B runtime-hardening slice | Replaced root/port 80 in local source with the non-root `node` user on port 8080, added CI/image invariant checks, and exposed runtime UID evidence through `/healthz`; Azure deployment remains separately gated |
| 2026-08-26 | Zero-traffic hardened runtime validation | Deployed `--p1b69b6b7a` from immutable image `helmonic-consult:69b6b7af9283657c9f509385fcb2050ab01c65c4` at 0%/min 0, proved UID 1000 plus `/healthz` and `/readyz` 200 from inside the container, removed its temporary label, confirmed it returned to 0 replicas, and left ingress 80 with `--ca72a0c` at 100% |
| 2026-08-26 | Coordinated non-root production cutover | Changed application ingress from port 80 to 8080, persisted `--p1b69b6b7a` at 100% with `--ca72a0c` and `--0000001` at 0%, preserved the exact IP allowlist, and validated the authenticated live Consult UI plus a four-passage document/page citation query. No resource, SKU, or minimum-replica change was made; the approved validation stayed below the $0.01 ceiling |
| 2026-08-26 | Phase 1B quick-fix slice | Centralized the real sixteen-document UI count, made the controlled uploader reproducible and fail-closed on sixteen documents, added a five-case retrieval evaluation suite, and changed controlled lexical retrieval from recall-first `any` matching to title-aware precision-first `all` matching. Local suite validation, generated route types, TypeScript, and lint passed; live evaluation remains gated on deployment |
| 2026-08-26 | Phase 1B local application-contract slice | Added the unapplied owner-scoped persistence migration/repository, real PDF streaming/Blob/Service Bus upload path, isolated session-index schema and filtered retrieval, persistent folder/conversation APIs, and strictly separate general-context Model Gateway/UI contract. All features default disabled; no Azure state or cost changed |
| 2026-08-26 | PAYG read-only status check | Subscription policy still returned `FreeTrial_2014-09-01` with spending limit `On`; no Speech/model/quota/deployment action was started |
| 2026-08-26 | Phase 1B combined Azure validation and cleanup | Applied and verified the nine-table migration plus isolated Blob/Search resources; validated non-root health/readiness, authenticated nested folders, and the real PDF-to-Blob/database/Service-Bus path to `queued`; found the blocking `searchFields` array-versus-string HTTP-400 defect in all five live retrieval cases; deleted the synthetic Blob/message/database data, deactivated the zero-traffic revision, restored the single permanent Entra callback, and removed both temporary identities/admins/roles/jobs and the validation ACR tag. Live traffic remained 100% on `--p1b69b6b7a` throughout |
| 2026-08-27 | PAYG, access, and audit-gap closure | Verified the subscription as Active/Paid PAYG; confirmed 333 kTPM GPT-5.5 and 20 kTPM Mistral Large 3 EU Data Zone quota/capacity without submitting redundant increases; restricted Entra access to exactly Ammar Ahsan and Jim Dunne while preserving the IP/CORS/traffic controls; fixed Search request serialization and CommonJS lint scope locally; added an explicit zero-traffic deployment-template guard. Live retrieval and CI remain pending a newly published validation image |
| 2026-08-27 | `4316906` CI and first private retrieval rerun | GitHub CI, immutable ACR image build, and Vercel Preview check passed. The private five-case job confirmed the Search request is accepted and both no-evidence cases pass, but raw filler terms caused zero results for all three expected-evidence cases. The branch was not promoted; temporary job/identity/Search role were deleted, while the validation ACR tag remains pending separately approved delete permission |
| 2026-08-27 | Stored next-revision template correction | Replaced stale `e20378e` inheritance with explicit image `69b6b7a` and disabled Phase 1B flags. `--p1btmpl69b6` reached Healthy/Provisioned at 0%, was deactivated to zero replicas, and live traffic stayed 100% on `--p1b69b6b7a` |
| 2026-08-27 | Model lifecycle and DPA verification | Confirmed GPT-5.5 `2026-04-24` is GA in both Microsoft lifecycle documentation and live Azure metadata. Confirmed the DPA Preview restriction applies to any Personal Data, not a special `regulated personal data` subset. Removed Mistral Large 3 from the candidate set entirely because it is Preview and the corpus includes identifying names/signatures and one person-linked residential address; reconsideration is prohibited unless Microsoft marks it GA. GPT-5.5 is the sole primary candidate |
| 2026-08-27 | `9117dfa` / `db4b296` final private retrieval validation | CI, immutable ACR build, and Vercel Preview passed for the query-normalization implementation. The private five-case Azure Search run passed after aligning the Wetherspoon expectation with the real sixteen-document corpus: Harold's Cross, Premier Inn, and Wetherspoon questions returned their correct projects; the France question returned no evidence. Deleted the temporary job, UAMI, Search role, both validation tags, and both short-lived repository-scoped ACR Contributor grants. Live traffic remained 100% on `--p1b69b6b7a`; no model was deployed |
| 2026-08-27 | Target A Model Gateway implementation | Wired document generation through the provider-neutral gateway; added managed-identity GPT-5.5 request settings (`high`, 2,000-token hard ceiling), fail-closed document-marker validation, token/citation telemetry without document content, and a live-capable five-case generated-answer evaluator. Offline generated/retrieval suites, generated route types, TypeScript, and lint passed. No Azure resource, revision, model, or traffic changed in this code step |
| 2026-08-27 | Approved GPT-5.5 private foundation | Deployed GA `gpt-5.5` version `2026-04-24` as `DataZoneStandard` in North Europe with a 10 kTPM rate limit; created approved private endpoint `pe-ai-helmonic-dev-001`, private DNS zone/VNet link, and the account-scoped `Cognitive Services OpenAI User` role for the Container App system identity. Foundry public access stayed disabled and live Container App traffic stayed 100% on `--p1b69b6b7a`. No model request or application revision was made in this foundation step |
| 2026-08-27 | Target A private validation and live cutover | Deployed immutable image `78f31b9...` at zero traffic, proved non-root UID 1000 plus `/healthz` and `/readyz`, and validated one grounded known-evidence response plus a no-evidence response. The private five-case generated-answer suite then passed: all four evidence cases used valid document/page citations, including the Wetherspoon relevance guard, and the France case returned no answer or citations. Created final min-zero revision `--p1bgpt55fin`, shifted it to 100%, retained `--p1b69b6b7a` at 0% for rollback, and deactivated both temporary GPT validation revisions. Five paid model calls were made; the enforced per-call ceiling bounds validation model usage below $0.3575 and therefore below the approved $0.80 ceiling |
| 2026-08-28 | Pilot-diagram reconciliation and local hybrid retrieval slice | Confirmed the out-of-scope box unchanged, GPT-5.5 as the sole provider, and lexical-only v1 as the gap to fix. Added disabled local contracts for `text-embedding-3-small`, versioned `consult-demo-v2`, managed-identity chunk/query embeddings, atomic table manifests, v1/v2 parity, pre-filtered BM25+HNSW retrieval, semantic/RRF cutoffs before citation creation, and eight-case evaluation plus unit tests. Offline fixtures, threshold tests, generated-answer policy, lint, and TypeScript pass. No Azure resource, index, ingestion, deployment, or traffic changed; D-011 cost approval remains the next gate |
| 2026-08-28 | Approved hybrid embedding foundation | Reconfirmed France Central `text-embedding-3-small` Data Zone quota at 0 of 1,000, then created `aif-helmonic-embed-dev-001` with public access disabled/default deny from its initial resource PUT, deployed version 1 as `DataZoneStandard` capacity 1, created/approved `pe-ai-embed-helmonic-dev-001`, added dedicated `privatelink.openai.azure.com` DNS with VNet link and the correct endpoint zone group, and scoped the Container App identity to `Cognitive Services OpenAI User` on only the new account. Live `consult-demo-v1` and traffic were unchanged |
| 2026-08-28 | Hybrid private validation and complete temporary cleanup | Temporarily raised the embedding deployment from 1 to 100 kTPM, then restored it to 1 immediately after the terminal run. The private job read all sixteen controlled PDFs and built 414 chunks including 87 table pages, but Azure rejected the first embedding call with `403 Traffic is not from an approved private endpoint`; in-job DNS nevertheless resolved the approved account connection to private IP `10.36.1.11`, so v2 ingestion and the eight-case evaluation did not run. Deleted the job, UAMI, all five UAMI roles, temporary ACR repository, and both short-lived repository-scoped user grants. Verified live traffic remains 100% on `--p1bgpt55fin` and `AZURE_SEARCH_INDEX=consult-demo-v1` |
| 2026-08-31 | Multi-UAMI diagnosis, cleanup, and local identity-selection correction | Later validation attempts returned managed-identity HTTP 400 `invalid_scope` (`No User Assigned or Delegated Managed Identity found for specified ClientId/ResourceId/PrincipalId`) before Search or embedding data calls. No active Container Apps service-health incident was found, while a same-environment throwaway job with only a system-assigned identity received HTTP 200 from the identity endpoint; this isolates the failure to the temporary UAMI path rather than the environment or private network. The standing ACR UAMI is consumed separately by the platform image-pull configuration. Because the disposable job attaches both ACR-pull and ingestion UAMIs, the Node uploader and evaluator were changed from ambiguous `DefaultAzureCredential` discovery to an explicit, fail-closed `ManagedIdentityCredential(AZURE_CLIENT_ID)` contract with regression tests and explicit container packaging. Seven policy/identity tests, the eight-case offline retrieval contract, seven-case generated-answer policy, lint, TypeScript, and runtime-hardening checks pass. Deleted and independently confirmed absent the diagnostic/validation jobs, disposable UAMI, five roles, temporary ACR repository and grant, and local payload archive. Live v1 and traffic were untouched; the corrected path remains pending a separately approved private validation run |
| 2026-08-31 | First explicit-UAMI private hybrid run and parity timing correction | The corrected job acquired tokens with the selected ingestion UAMI, read all sixteen source documents, and built 414 chunks including 87 table pages, resolving the prior identity-endpoint blocker. Azure Search accepted the v2 upload but exposed only 348 of 414 chunks to the immediate parity query, so the fail-closed check stopped before the eight cases and live v1/traffic remained untouched. The uploader now waits through a bounded asynchronous-indexing window and rechecks the exact 414-chunk/source/title/page manifest; it does not relax parity or permit partial cutover. |
| 2026-08-31 | `743fe63` final hybrid validation and cleanup | Added bounded Search-index visibility retries without weakening exact parity, with three regression tests and synchronized operator/architecture documentation. PR #16 CI and immutable ACR build passed. The private job embedded and indexed all sixteen documents as 414 chunks including 87 table pages, proved exact v1/v2 source-title-page parity, and passed all eight semantic/hybrid relevance cases with zero failures. Restored the embedding deployment from the temporary 100 kTPM validation limit to 1 kTPM; deleted the job, ingestion UAMI, all five roles, both temporary ACR tags/manifests and repository, short-lived user grant, Cloud Shell clone, and local GitHub CLI credential bundle. Independently verified zero job/UAMI/role/grant counts, live traffic 100% on `--p1bgpt55fin`, and live `AZURE_SEARCH_INDEX=consult-demo-v1`. `consult-demo-v2` remains isolated pending a separately approved zero-traffic/runtime cutover. |
| 2026-08-31 | D-022 inline general-knowledge source slice | Superseded the split D-009 experience with one feature-gated GPT-5.5 answer, preserving strict server-authoritative `D`/`A` citations while allowing sequential unverified `G` disclosure markers. Removed the separate response/UI block and curated-index dependency, added the persistent conditional disclaimer and explicit no-document-evidence rule, and added six offline contract tests plus a CI policy gate. No Azure resource, model deployment, revision, flag, Search index, live request, or traffic change occurred; live DEV remains on v1 with general knowledge disabled. |
| 2026-08-31 | Hybrid v2 zero-traffic promotion gate stopped | Created `--hyb743fe63` from immutable image `743fe63...` with minimum replicas zero, `consult-demo-v2`, hybrid/semantic retrieval enabled, and general context disabled; verified it active at 0% while `--p1bgpt55fin` stayed at 100%. `/healthz` returned healthy with UID 1000/non-root. A direct-revision Wetherspoon smoke query returned four real citations from pages 3 and 7 of the correct report, but the answer gave a 7 dB recommended-level exceedance and said the exact background comparison was unavailable instead of satisfying the suite's expected 19 dB result. Per the fail-closed gate, no further paid queries or traffic shift occurred. The temporary Entra callback used only for the direct revision was removed and the sole permanent callback independently reconfirmed. The candidate remains active at 0% for controlled diagnosis; live v1 and rollback state are unchanged. |
| 2026-08-31 | Wetherspoon regression diagnosis corrected by live evidence | Source inspection first proved the expected 66 dB rating, 47 dB background, and 19 dB difference exist in Table 6 on report/PDF page 7. A provisional same-page table lookup passed local tests, but its first zero-traffic live query still returned four page-7/page-3 citations and the 7 dB answer. Ingestion-code and live-output comparison then established the precise cause: all page-7 tables are appended to one atomic chunk that was already retrieved, while the server exposed only its first 420 characters to GPT-5.5. The second Search call was removed. Hybrid Search now selects `chunk_kind`; atomic table evidence receives a bounded 3,000-character projection while ordinary narrative remains at 420. Tests explicitly prove 66 dB, 47 dB, and 19 dB survive the table projection. Live v1, permission filtering, the threshold, general-context flag, and traffic remain unchanged. |
| 2026-08-31 | CI parity corrections before hybrid deployment | The first approved push reached Vercel Preview and built the ACR image, but CI stopped before application build because Node 22.22.2 does not accept the later `--test-isolation=none` spelling. The suite still needs in-process execution in the restricted local runner, so only `test:model-policy` was changed to Node 22's compatible `--experimental-test-isolation=none` alias; its six cases then passed in CI. The next gate exposed one stale E2E assertion for the separate `generalContext` object removed by D-022; the fail-closed route correctly returns the documented single-answer contract, so that obsolete assertion was removed without changing runtime behavior. No Azure revision, index, flag, request, or traffic change occurred. |
| 2026-08-31 | `5237aa3` zero-traffic gate stopped on first Wetherspoon query | CI, ACR, and Vercel Preview passed after the parity corrections. Created `--hyb5237aa3` from immutable image `5237aa3...` with minimum replicas zero, v2 hybrid/semantic retrieval enabled, uploads/folders/general context disabled, and live traffic still 100% on `--p1bgpt55fin`. Container Apps reported the corrected replica Healthy/Provisioned, proving its configured health/readiness probes. The authenticated Wetherspoon query still answered 7 dB because table values were truncated from the model evidence projection. Per the fail-closed gate, the other paid cases did not run. The temporary callback remains scheduled for removal after the replacement revision is validated or this attempt is closed; no traffic or v1 configuration changed. |
| 2026-09-02 | `570514c` full zero-traffic hybrid/generated validation passed | CI, immutable ACR build, and Vercel Preview were green for the structured-table-first evidence fix. Healthy zero-traffic revision `--hyb570514c` used the exact immutable image, `consult-demo-v2`, hybrid and semantic retrieval, minimum replicas zero, and general context/uploads/folders disabled. All eight live cases passed: Harold's Cross and Premier Inn paraphrases returned the correct reports; the Wetherspoon comparison returned 66 dB versus 47 dB and the required 19 dB difference with no Premier Inn contamination; the 500 Hz table case returned 54 dB; the sound, France-population, and sourdough questions returned insufficient evidence with zero sources; and a disposable same-image zero-traffic revision with server-authoritative scope `unauthorized-evaluation-scope` returned no evidence for the in-corpus Premier Inn question, proving the permission pre-filter without exposing a caller-controlled test hook. The scope probe and template-restoration revision were deactivated, the stored next-revision template was restored to the authorized v2 configuration, both temporary Entra callbacks were removed, and failed pre-build ACR Quick Run attempts produced no repository or image. Live traffic remained 100% on `--p1bgpt55fin`/v1. No traffic or index cutover was made; that remains a separate approval. |
| 2026-09-02 | Staged hybrid v2 live cutover completed | After a separate under-USD-0.10 approval, traffic moved from `--p1bgpt55fin`/`consult-demo-v1` to `--hyb570514c`/`consult-demo-v2` through independently verified 10%, 25%, 50%, and 100% stages. Each stage held for authenticated UI loads and Azure health/metrics checks. Sixty repeated authenticated page loads succeeded across the staged window; the 50% no-evidence query returned zero sources, and the 100% Wetherspoon 500 Hz query returned 54 dB with four server-verified page citations. The final observation recorded zero 5xx responses and no restarts; ordinary repeated loads remained sub-1.3 seconds apart from isolated scale/cold-routing samples that did not recur. The v1 revision remains active and Healthy at 0% for immediate rollback and is eligible for retirement after owner confirmation. No new resource or recurring cost was introduced. |
| 2026-09-02 | D-023 full-corpus discovery gate implemented and completed | Added a read-only, resumable audit and Windows launcher for the approximately 300 GB mapped collection. It encodes the five owner-approved exclusions, IA-02.1/IA-02.2 mapping, validated reference/third-party treatment, Cadna raw/calculation classification flag, and unmapped IA-21 warning. Synthetic end-to-end tests passed, followed by an all-page normal-Windows run over 29,703 files/286.9 GB with zero scan errors and no source mutation. The corpus contains 2,308 PDFs and 325 Word files; 21 documents are broken/unreadable, none are encrypted, 197 are strong OCR candidates, 50 are partial OCR candidates, 134 exact duplicate groups contain 147 extra copies, and 332 possible filename-variant groups require review. No Azure call or cost occurred. |
| 2026-09-04 | D-024 PST metadata-only inventory kickoff | Retained the owner-provided PST scope, selected pinned Ms-PL XstReader rather than Outlook profile attachment, and added a local read-only inventory for Glen, Owen, and optional Jim. The code whitelists message/recipient/attachment metadata, blocks known payload APIs at build time, asserts at runtime that body and attachment content remain unloaded, writes sensitive reports only beneath ignored local artifacts, and makes no Azure call. Compilation, executable self-test, and offline privacy-contract tests pass. The isolated agent could not authenticate to the company share, so the real inventory is pending a normal signed-in PowerShell run; no findings are inferred and third-party consent remains open. |
| 2026-09-04 | PST launcher Windows PowerShell compatibility correction | The first normal-Windows launch stopped safely before opening a PST because Windows PowerShell 5.1 bound the build guard's string split differently from PowerShell 7 and falsely reported multiple class declarations. Replaced both declaration counts with version-stable exact regex counts and tested the build through `powershell.exe`; the privacy guard remains fail-closed and no source archive was touched by the failed launch. |
| 2026-09-04 | D-025 corpus-to-ingestion plan | Reconciled the completed audit through eleven passing quality checks and produced a reproducible, executive-readable October plan. The 286.9 GB discovery universe narrows to 2,633 PDF/Word files/6.79 GB; exact deduplication and conservative IA-21/Cadna cross-category holds leave 2,064 technically eligible unique documents (1,779 PDFs, 285 Word render candidates). The plan uses a human-approved 100-PDF pilot, 250–400-document scale batches, validated Word-to-PDF conversion, deferred/targeted OCR, manifest/version/permission gates, and proportional acoustic evaluation. No Azure resource, standing identity, queue execution, index write, model call, upload, or cost occurred. |
| 2026-09-04 | D-026 capture-all manifest kickoff | Expanded the final target from the first 2,064 searchable documents to every audited approved original. Added a deterministic private JSONL manifest that reconciles all 29,703 files/286.9 GB, marks every original for Blob capture, links 147 duplicate copies, propagates three cross-category duplicate holds, routes every format to a controlled processing lane, and leaves all permission scopes unset before Search. Four corpus tests pass. No company-share write, Azure call, resource, upload, model/embedding call, index change, traffic change, or cost occurred. |
| 2026-09-04 | D-027 read-only audio classification utility | The existing audit shows 3,512 WAV files/204.0 decimal GB: 3,403 under IA-02.2 and 109 under IA-06; 224 of 399 WAV directories contain acoustic-measurement formats, 219 contain text exports, and only two filenames contain a voice/speech hint. Added a normal-Windows header-only audit and deterministic review sampler that records duration/format/companion aggregates without decoding, copying, playing, transcribing, uploading, or modifying audio. The synthetic source-preservation test and PowerShell parse check pass. The real share run is pending user launch; no Azure call or cost occurred. |
| 2026-09-04 | D-027 real WAV header audit completed | The normal-Windows run inspected all 3,512 expected WAV headers with zero errors and no source mutation. It measured 4,565.7 hours/190.2 days of audio; the median file is two minutes, p90 one hour, and p99 twelve hours. The dominant signature is mono 24 kHz 4-bit format-tag-17 audio (3,143 files), and 1,253 WAVs have acoustic-measurement companions, supporting the hypothesis that this is predominantly monitoring evidence rather than speech. Two tiny compound-name `VoiceNote` files initially escaped the display counter; the detector and regression test were corrected, and both files share the dominant measurement-audio signature. No content was decoded, copied, played, transcribed, uploaded, or sent to Azure; cost remained USD 0. |
| 2026-09-04 | D-028 audio evidence decision | Jim confirmed that approved WAV recordings should be retained inside Helmonic for project reference. The capture-all manifest now assigns all WAVs the `AU` citation namespace; the design requires project/report/measurement linkage, exact timestamp citations, and controlled playback while prohibiting unsupported level claims and broad automatic transcription. This local decision made no Azure upload, resource, model, live application, index, traffic, or cost change. |
| 2026-09-04 | D-028 bounded audio pilot prepared | Added and tested a deterministic 12-file WAV pilot selector with a 512 MiB ceiling and fail-closed `pilot_only` state. The real private output totals only 8,485,614 bytes while covering IA-02.2/IA-06, all three observed format tags, short/medium/long durations, multichannel audio, compound voice-note names, and measurement/PDF/text companions. Format-tag-17 files require a controlled playback derivative. No source, Azure, live application, index, traffic, transcription, model, or cost change occurred. |
| 2026-09-04 | D-028 private audio-pilot path implemented locally | Added a normal-Windows source-preserving staging launcher plus a non-root managed-identity uploader. The payload contract enforces twelve files, a 512 MiB ceiling, `iAcoustics` scope, safe opaque Blob names, `AU` citations, and `pilot_only`/no-content-processing state. The uploader writes to the separate private `consult-controlled-audio` container, refuses silent overwrite, retains a private project-link catalog, and verifies stored length/hash metadata plus authorized WAVE byte-range reads. Repository and Docker ignores prevent ordinary builds or Git from capturing private payloads; CI now runs the offline contract tests. The sandbox still cannot authenticate to the mapped share, so the selected originals await the normal-Windows staging command. No source, Azure, live application, index, traffic, transcription, model, or cost change occurred. |
| 2026-09-04 | D-028 private audio payload staged | The normal-Windows launcher copied the twelve selected WAVs into the ignored disposable build context: 8,485,614 bytes, twelve matching payload/file counts, and zero SHA-256 or size mismatches. Its first run failed only while formatting the final byte-count display because `Measure-Object` cannot read a property from the ordered dictionaries used there; the already-complete payload correctly blocked overwrite on the second run. The display now reuses the prevalidated byte total. No rerun is required, no source was modified, and no Azure call, upload, resource, live application, index, traffic, transcription, model, or cost change has yet occurred. |
| 2026-09-04 | D-028 twelve-file private Azure audio pilot passed | A disposable 7.392 MiB ACR build context produced image `helmonic-consult-audio-pilot:7bda31e`; an initial two-second ACR run failed before build because the ABAC registry requires explicit caller authentication, and the corrected `[caller]` run succeeded. Temporary job execution `job-audio-pilot-001-69x5zho` ran for 37 seconds in the existing VNet-integrated Container Apps environment with the standing pull UAMI plus a dedicated data UAMI explicitly selected by client ID. The uploader reached its terminal success state only after all twelve WAVs and the private project-link catalog were stored in `consult-controlled-audio`, stored length/hash metadata matched, and authorized WAVE byte-range reads passed. The files remain `pilot_only`, `iAcoustics`-scoped, `AU`-namespaced, and untranscribed; no Search index, model, app revision, or traffic changed. Live traffic independently remained 100% on `--hyb570514c`. The job, data UAMI, and its only Blob role were deleted and independently absent. |
| 2026-09-04 | D-028 Azure audio-pilot cleanup completed | After explicit approval, assigned `Container Registry Repository Contributor` temporarily to the operator with Microsoft's repository-name ABAC condition restricted to `helmonic-consult-audio-pilot`. Deleted the repository, tag `7bda31e`, and manifest `sha256:25c86c5fff4b921874615286960897baf6c0a9511bbe686295da8558e0a9decc`, then revoked assignment `e78a15f3-d55b-4778-9706-bf197e9192b4` immediately. Independent checks returned repository not found and empty matches for the grant, disposable job, UAMI, and UAMI roles. Live traffic remained 100% on `--hyb570514c`; the twelve private Blob originals and catalog were deliberately retained as the successful pilot result. |
| 2026-09-04 | D-029 standing ingestion identity proven | Created persistent North Europe UAMI `uami-helmonic-ingestion-001` with only `Storage Blob Data Contributor` on `sthelmonicdev001`, `Search Index Data Contributor` on `srch-helmonic-dev-001`, and `Cognitive Services OpenAI User` on `aif-helmonic-embed-dev-001`. Seven fail-closed local tests passed. The first ACR quick-build invocation selected the repository application Dockerfile rather than the staged proof Dockerfile and failed without an output image; rerunning from the six-file/60.6 KiB staged context selected the intended non-root proof image. Disposable execution `job-standing-worker-proof-001-6ei0h1e` explicitly selected the standing client ID and succeeded in 35 seconds after a synthetic Blob upload/read/delete, one 1,536-dimensional embedding, and isolated `consult-session-v1` Search write/query/delete; its terminal path verified both synthetic records absent. No real content was used. Deleted the job and ACR repository/tag/both manifests, revoked the repository-scoped cleanup grant, and independently confirmed all were absent. The standing UAMI and exactly three roles remain; the temporary-identity path remains as fallback. Live traffic stayed 100% on `--hyb570514c`; the 100-document batch was not started. |
| 2026-09-04 | D-030 100-PDF batch path prepared; source staging pending | GitHub reported all `fa3c8c8` checks successful: CI/build-and-test, immutable ACR image build, Vercel Preview, and combined status. Added a deterministic nine-category selector, audited-source stability/hash/page checks, full readable-page extraction, atomic table preservation, a candidate-index-only standing-UAMI uploader, exact chunk/vector parity, six distributed hybrid probes, and positive/negative permission checks. Four new offline tests and targeted lint passed. Two sandbox attempts stopped on the first file with Windows access denied before any source was copied or any Azure call occurred; the partial private contexts were removed from the workspace. The same source-staging command must run once in normal signed-in PowerShell. No Azure index, Blob, embedding, Search write, job, image, cost, live configuration, or traffic change occurred. |
| 2026-09-04 | D-030 private 100-PDF payload staged | The normal signed-in Windows run staged 100 canonical readable PDFs across nine categories into ignored private build storage: 254,787,552 bytes, 1,871 pages, 2,631 chunks, and 342 table pages, all with internal `iAcoustics` scope and `D` citations. A complex table temporarily drove extraction into several GiB of memory and one PDF emitted a decompression warning, so no Azure write followed and the batch remained non-promotable pending independent integrity verification plus reusable resource limits/checkpointing. Live traffic and `consult-demo-v2` were untouched. |
| 2026-09-04 | D-031 bounded resumable two-reader policy implemented locally | Replaced the batch-wide unbounded extractor with a child process per document, default ten-minute/2 GiB working-set ceiling, atomic source-ID checkpoint, hash-verified resume, and fail-closed manual-review outcome. Every PDF now passes both pdfminer/pdfplumber and pypdf page/readability checks before it can enter a candidate payload; recoverable corruption is explicitly marked and incomplete evidence is quarantined without OCR or invented content. Ten Python tests cover selection/exclusions, verified/recovered/quarantined and legitimate-blank reader outcomes, forced timeout, forced memory termination, checkpoint identity/limit mismatch, hash-verified resume, a real synthetic PDF worker, and the legacy-staging annotation bridge; three Node contract tests prove the Azure path rejects missing verification. This was a $0 local change: no Azure write, index, Blob, embedding, job, revision, live configuration, or traffic change occurred. |
| 2026-09-04 | D-031 100-PDF two-reader integrity gate passed | The independent pass rehashed and opened all 100 staged originals with pdfminer/pdfplumber and pypdf. All hashes matched and both readers agreed on 1,871 actual pages. Eighty-seven documents passed directly; thirteen were marked `repair_verified`: ten used the tolerant second-reader path for repairable metadata/xref defects and three corrected the old chunk-derived counter for trailing pages (including the one decompression-warning PDF). Two other documents contained legitimate non-text pages but were structurally complete. Zero documents require quarantine or replacement. The private payload now carries per-document integrity/page-count records and passes the fail-closed Azure payload contract. No Azure write or live change occurred. |
| 2026-09-04 | D-032 candidate preflight aligned with standing least privilege | Created isolated index `consult-candidate-pilot-100-v1` through a single-purpose system identity holding temporary `Search Service Contributor`; its only successful request returned HTTP 201 for that exact candidate name. The role and job were then deleted and independently returned empty Azure listings. The first standing-UAMI ingestion execution failed closed on an index-definition GET with HTTP 403 before any embedding, Blob upload, or Search document write; its job was deleted and embedding capacity restored from 100 to 1 kTPM. Replaced that management/schema lookup with a candidate-only document search probe that exercises the 1,536-dimensional `content_vector` and filterable `permission_scope` fields using the standing identity's existing `Search Index Data Contributor` role. The standing UAMI remains at exactly three roles; live `consult-demo-v2`, its application setting, and 100% traffic on `--hyb570514c` were unchanged. |
| 2026-09-04 | D-033 candidate Blob metadata failure fixed before rerun | The corrected standing-UAMI job passed its candidate preflight and processed 1,537,291 embedding input tokens/167 model requests, then failed closed on the first Blob PUT with HTTP 400 before any Search document write. Comparison with the already-proven audio and standing-worker paths isolated the defect: metadata suffixes `source-id`, `source-sha256`, and `permission-scope` contained invalid hyphens, whereas Azure-safe metadata keys use letters/digits/underscores. The job was deleted and embedding capacity restored to 1 kTPM. The uploader now uses `sourceid`, `sourcesha256`, and `permissionscope`, refuses overwrite, verifies stored length and metadata after every PUT or pre-existing-object response, includes Azure response detail on failure, and performs Blob upload/read-back before paid embeddings. Live index/configuration/traffic remained untouched. |
| 2026-09-04 | D-034 100-PDF candidate validation passed | Commit `b3110b4` passed GitHub build/test, immutable ACR build, and Vercel Preview. Its private execution ran for approximately 17 minutes 20 seconds with the standing UAMI and completed 100 verified Blob originals (254,787,552 bytes), 2,631 Search chunks, 2,631 matching 1,536-dimensional vectors, exact manifest parity, and all eight automated cases: six distributed source probes retained their expected source, the internal scope returned evidence, and the unauthorized scope returned zero. The successful run measured 1,668,779 embedding input tokens/179 model requests; including the earlier Blob-metadata failure, the working session used 3,206,070 embedding input tokens, still far below the approved USD 5 ceiling. The candidate remains `promotionReady: false` pending consultant known-answer evaluation. Both disposable jobs and the temporary Search schema role are independently absent, the embedding deployment is restored to 1 kTPM, and the standing identity still has exactly its three approved roles. Live `consult-demo-v2`, its data path, and 100% traffic on `--hyb570514c` were untouched. |
| 2026-09-04 | D-034 private ACR cleanup completed | After separate confirmation, assigned `Container Registry Repository Contributor` to the operator at the existing ACR scope with ABAC condition `repositories:name StringEqualsIgnoreCase 'helmonic-consult-corpus-pilot'`. Deleted only that private validation repository, then immediately revoked assignment `e54e54fa-0261-46cf-b52c-0a21b16d64d0`. Independent post-cleanup queries returned `repository ... is not found` and an empty matching role-assignment list. No Search index, live revision, traffic setting, new resource, or cost was involved. |
| 2026-09-04 | First real PST metadata run completed with retained source-access failures | The normal-Windows run produced local ignored reports for Glen and Owen and retained 44,568 readable email items, 13,475 other items, and 141,518 attachment metadata entries. It is partial rather than final: Glen has 3,416 directory-not-found item failures plus five illegal-path and one network failure; Owen has 13,251 item failures because another process held `backup_owen.pst`. Jim's PST was absent. No email body, attachment payload, source write, Outlook profile mutation, Azure call, or cost occurred. The next run must use stable mapped-share access with both PST files closed elsewhere. |

Azure operational changes after `ca72a0c` were performed under explicit approvals but
did not all have corresponding source commits because they were configuration/data
operations. Going forward, every such operation must update this chronology and current
status in the same working session and be committed/pushed with the related application
or infrastructure record.

## 1. Purpose

Phase 1B extends the proven Phase 1A Consult vertical slice into a persistent,
user-operated document workspace. It adds real document attachment and ingestion,
persistent conversations and folders, speech-to-text input, and a strictly separated
general-context capability. D-022 now implements that context as visibly marked prose
inside one flowing answer rather than a second answer block.

The design preserves the core Phase 1A guarantees:

- Microsoft Entra authentication and the approved source-IP restriction remain
  enforced before application code is reached.
- The UI and API remain on the Container App's single origin. CORS remains disabled.
- Vercel remains an inert frontend preview and is not connected to the Azure backend.
- Controlled-document answers remain grounded in server-retrieved evidence.
- Every document claim retains a real source and page citation.
- Insufficient and conflicting evidence are stated explicitly.
- Managed identity and private networking remain the default Azure access pattern.
- No cost-incurring action is performed without a specific estimate and approval.

## 2. Phase 1A baseline

Phase 1A currently provides:

- A Next.js UI/API running in Azure Container Apps.
- A live authenticated Consult URL protected by Entra and an IP allowlist.
- Sixteen controlled iAcoustics PDFs stored in Azure Blob Storage and indexed in
  Azure AI Search.
- Page-preserving retrieval with server-authoritative citations.
- A permanent Sources panel for retrieved document passages.
- A retrieval-only fallback when no permitted generative model is configured.
- PostgreSQL, Blob Storage, Azure AI Search, Key Vault, Service Bus, ACR, managed
  identities, private endpoints, and Log Analytics in the existing DEV architecture.
- A zero-traffic rollback revision.

Phase 1A does not currently provide real browser uploads, persistent conversations,
folder organization, speech input, or live general-context generation.

## 3. Phase 1B scope

### 3.1 In scope

1. Real PDF attachment and ingestion in Consult.
2. Strict separation between conversation attachments and controlled company sources.
3. Persistent conversations, messages, citations, folders, and subfolders.
4. Speech-to-text input through Azure Speech, implemented behind a disabled feature
   flag until its Azure deployment is approved.
5. A separately generated and separately cited general-context section.
6. End-to-end architecture, operations, security, deployment, and cost documentation.
7. Removal of the temporary root/port-80 runtime exception before live uploads.
8. Read-only inventory and prioritization of the approximately 300 GB controlled-source
   candidate collection before any bulk upload.
9. Word-to-PDF conversion with a render-quality gate so page citations remain authoritative.
10. An evidence-based OCR decision after the full-corpus page analysis and spot check.

### 3.2 Initially out of scope

- Automatic ingestion of arbitrary websites.
- Unrestricted live-web search under the current EU-only governance posture.
- Automatic email or external messaging.
- Autonomous promotion of attachments into the controlled knowledge base.
- Automatic OCR deployment before the corpus audit and separate costed decision.
- CSV ingestion where mandatory page citations cannot be guaranteed.
- Multi-tenant administration and broad user provisioning.
- Permanent audio retention.
- Fine-tuning a language model on Helmonic documents.

## 4. Target architecture

```text
Authenticated browser
        |
        | same-origin HTTPS
        v
Azure Container App: Helmonic UI + API
        |
        +--> PostgreSQL
        |      conversations, folders, messages, documents,
        |      ingestion status, citation snapshots, audit events
        |
        +--> Blob Storage
        |      controlled sources, session uploads, exports
        |
        +--> Service Bus queue
        |      durable ingestion work
        |
        +--> Container Apps ingestion job
        |      validate, extract by page, chunk, index, clean up
        |
        +--> Azure OpenAI embeddings (provisioned; private v2 validation passed)
        |      identical managed-identity chunk/query vectors
        |
        +--> Azure AI Search
        |      versioned controlled hybrid index and session index
        |
        +--> GPT-5.5 Data Zone Standard (live, sole provider)
        |      document answer; feature-gated inline [G] context is source-only today
        |
        +--> Azure Speech (pending resource/cost approval)
               short speech-to-text transcription
```

The ingestion worker is separated from the interactive web process so malformed or
slow documents cannot block chat requests. It runs with its own least-privilege managed
identity and can scale to zero when no ingestion work exists.

## 5. Storage separation

Separate Blob containers are used instead of virtual folders alone. This provides a
stronger RBAC, lifecycle, and operational boundary.

### 5.1 `consult-session-uploads`

Purpose: temporary files attached during brainstorming or a Consult conversation.

Recommended blob path:

```text
{owner-object-id}/{conversation-id}/{document-id}/{sanitized-file-name}.pdf
```

Rules:

- A file is accessible only to its owner and its conversation.
- It is never retrieved for an unrelated conversation.
- It is never treated as an approved organizational source.
- It receives a configurable expiry time.
- Deleting the conversation schedules deletion of its session documents, search
  chunks, and retained extraction payloads.

Initial retention proposal: 30 days after the conversation's last activity. The final
retention value requires a product/data-governance decision before deployment.

### 5.2 `consult-sources`

Purpose: approved, controlled organizational source documents.

Rules:

- Existing Phase 1A documents remain here.
- Only the ingestion/promotion process can write to this container.
- Runtime users cannot silently promote an attachment.
- Promotion requires explicit confirmation, metadata review, duplicate checking, and
  successful permanent indexing.
- Removal is audited and removes associated active search chunks.

### 5.3 `consult-exports`

Purpose: future generated reports, evidence packs, and conversation exports.

This container is not required for the first Phase 1B delivery, but reserving its
boundary prevents generated artifacts from being mixed with evidence sources.

## 6. Search separation

Phase 1B uses separate indexes on the existing Azure AI Search service:

- `consult-demo-v1`: retained lexical controlled-document rollback target.
- `consult-demo-v2`: live versioned controlled hybrid/semantic index.
- `consult-session-v1`: temporary, conversation-scoped attachments.

Creating additional indexes does not create another Search service or another fixed
Search SKU charge.

### 6.1 Session-index security fields

Each session chunk includes:

- `chunk_id`
- `document_id`
- `document_version_id`
- `owner_object_id`
- `conversation_id`
- `source_type = session_attachment`
- `title`
- `page_number`
- `section`
- `content`
- `source_uri`
- `content_hash`
- `is_active`
- `expires_at`

Every session search request must include server-created filters for both
`owner_object_id` and `conversation_id`. The browser cannot provide or override the
effective owner identity.

### 6.2 Controlled-index fields

The existing v1 index retains its permission-scope filtering and remains untouched.
The proposed v2 index retains every v1 citation/permission field and adds
`chunk_kind`, `content_format`, and a non-retrievable 1,536-dimension
`content_vector`. Its cosine HNSW profile supports nearest-neighbour retrieval and its
`consult-semantic-v2` configuration prioritizes title, content, and section. Hybrid
requests apply `permission_scope` with `vectorFilterMode: preFilter`, so unauthorized
chunks are excluded during vector traversal rather than removed after ranking.

### 6.3 Curated-general fields

Each public reference includes:

- authoritative publisher
- public URL
- title
- publication/update date where known
- retrieval date
- content hash
- allowed domain/source classification
- licensing/storage note
- content and section/page locator where available

The general index never contains confidential Helmonic documents.

## 7. Document lifecycle

### 7.1 State machine

```text
uploading
  -> stored
  -> queued
  -> processing
  -> ready

Terminal/alternate states:
  duplicate
  quarantined
  failed
  expired
  deleted
```

A file is not queryable until its document version is marked `ready`. Search chunks
are versioned and activated only after the complete document has been indexed.

### 7.2 Upload controls

Initial controls:

- PDF only.
- Configurable maximum of 25-40 MB.
- Validate both file extension and binary signature.
- Sanitize the display name and generate the physical blob name server-side.
- Calculate SHA-256 before indexing.
- Reject encrypted/password-protected PDFs in the first release.
- Reject zero-page, corrupt, excessively large, and parser-timeout documents.
- Enforce page and extracted-text limits to mitigate decompression/parser abuse.
- Do not execute embedded files, scripts, macros, or links.
- Log identifiers and state transitions, never full document content.

Malware scanning is a separate design decision. Microsoft Defender for Storage or an
isolated scanner would require its own security, operational, and cost approval.

### 7.3 Page-preserving extraction

The worker extracts text page-by-page. Chunks never cross a page boundary in the
initial implementation, ensuring every chunk has an unambiguous page number. Headers,
footers, and empty pages are handled deterministically. The original PDF remains the
source of truth.

Extraction v2 also requires every table-bearing page to be declared in the approved
manifest. Frequency, octave-band, compliance, and similar tables are represented as one
atomic Markdown table or explicit key/value chunk on a single page. The ingestion path
rejects an undeclared format, split/non-atomic table, missing table-page chunk, or
unstructured table content. This is validated before vectors or v2 index state can be
treated as ready.

### 7.4 Duplicate handling

- Duplicate within the same conversation: do not re-index; show the existing item.
- Duplicate across the same user's conversations: store a new conversation link while
  reusing the existing immutable document version where policy permits.
- Duplicate of a controlled source: show that the file already exists in the controlled
  knowledge base without automatically changing its classification.
- Hash matches must not disclose another user's document existence in a future
  multi-user deployment.

### 7.5 Promotion

`Add to controlled knowledge base` is an explicit workflow:

1. User requests promotion.
2. Application displays title, classification, hash, pages, and detected duplicate.
3. Authorized user confirms.
4. Worker copies the immutable original into `consult-sources`.
5. Worker indexes it into the controlled index.
6. Controlled version becomes active only after successful validation.
7. Audit event records the actor, source attachment, target source, and result.

## 8. Persistent data model

The application uses a dedicated PostgreSQL `consult` schema. Migration ownership and
runtime CRUD permissions are separated.

### 8.1 Principal tables

#### `consult.folders`

- `id uuid primary key`
- `owner_object_id text not null`
- `parent_folder_id uuid null`
- `name text not null`
- `sort_order integer not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `deleted_at timestamptz null`

The parent relationship is restricted to the same owner. Cycles are rejected. An
initial maximum nesting depth of five is recommended.

#### `consult.conversations`

- `id uuid primary key`
- `owner_object_id text not null`
- `folder_id uuid null`
- `workspace text not null`
- `title text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `deleted_at timestamptz null`

#### `consult.messages`

- `id uuid primary key`
- `conversation_id uuid not null`
- `role text not null`
- `content text not null`
- `answer_mode text null`
- `request_id uuid null`
- `model_deployment text null`
- `created_at timestamptz not null`

#### `consult.message_citations`

Stores an immutable snapshot of the citation as it appeared when the answer was
generated. Later source updates must not silently rewrite historical evidence.

Fields include message, citation type, marker, source/document version, title, page,
section, excerpt, source URL/URI, search score, and content hash.

#### `consult.documents`

Stores stable document identity, owner, classification (`session` or `controlled`),
display title, lifecycle state, Blob location, hash, expiry, and timestamps.

#### `consult.document_versions`

Stores immutable versions, page count, extraction version, index name, index status,
and activation state.

#### `consult.conversation_documents`

Links session documents to conversations without conflating the conversation with the
underlying immutable file.

#### `consult.ingestion_jobs`

Stores the state machine, attempt count, timestamps, safe error code, and correlation
identifier for each ingestion or deletion operation.

#### `consult.audit_events`

Records security and data-lifecycle events without recording full document or prompt
content.

## 9. Application API

All routes are same-origin Next.js Node.js Route Handlers. The server derives the user
identity from the authenticated Azure request; it never trusts a browser-supplied
owner ID.

### 9.1 Conversations and folders

- `GET /api/consult/folders`
- `POST /api/consult/folders`
- `PATCH /api/consult/folders/{folderId}`
- `DELETE /api/consult/folders/{folderId}`
- `GET /api/consult/conversations`
- `POST /api/consult/conversations`
- `GET /api/consult/conversations/{conversationId}`
- `PATCH /api/consult/conversations/{conversationId}`
- `DELETE /api/consult/conversations/{conversationId}`
- `GET /api/consult/conversations/{conversationId}/messages`

### 9.2 Documents

- `POST /api/consult/conversations/{conversationId}/documents`
- `GET /api/consult/documents/{documentId}`
- `GET /api/consult/documents/{documentId}/status`
- `DELETE /api/consult/documents/{documentId}`
- `POST /api/consult/documents/{documentId}/retry`
- `POST /api/consult/documents/{documentId}/promote`

The upload handler streams content and does not load a maximum-size PDF into multiple
memory copies. It returns a document ID and initial state; extraction is asynchronous.

### 9.3 Query

`POST /api/consult/query` evolves to accept:

```json
{
  "conversationId": "uuid",
  "question": "string",
  "includeGeneralContext": true
}
```

The response keeps one answer while retaining the document-only compatibility object:

```json
{
  "requestId": "uuid",
  "answer": "one flowing answer or null",
  "citations": [],
  "generalKnowledgeUsed": true,
  "documentAnswer": {
    "status": "generated | retrieval-only | insufficient-evidence",
    "text": "string or null",
    "citations": []
  }
}
```

`citations` and `documentAnswer.citations` contain only server-authoritative `D`/`A`
sources. `generalKnowledgeUsed` controls the persistent `G` disclosure and never adds a
source card.

### 9.4 Speech

- `POST /api/consult/speech/transcribe`

The endpoint accepts a short supported audio payload and returns a transcript. Audio
is not retained by default. It is protected by a feature flag until Azure Speech is
provisioned and approved.

## 10. Retrieval and answer policy

### 10.1 Document evidence

The document-evidence retrieval step searches:

1. controlled sources permitted for the current profile; and
2. session attachments owned by the authenticated user and linked to the current
   conversation.

The server combines and reranks results while retaining their source classification.
The model is never allowed to create source metadata or citation identifiers.

For controlled v2 evidence, the server embeds the question with the same approved
deployment and dimensions used for every chunk, then sends BM25 text and cosine HNSW
vector components in one Azure AI Search request. Search fuses the result sets through
RRF and the selected semantic configuration reranks them. BM25 is retained deliberately
for exact frequencies, dB values, standards, codes, and other technical tokens that
dense embeddings can blur.

Nearest-neighbour search always returns candidates, so result existence is not evidence.
Before creating `D` citations, the server discards documents without the configured
score and those below the reviewable cutoff. The semantic candidate is `2.0` on the
documented 0-4 reranker scale. RRF `0.015` exists only as a configurable fallback and is
not approved for cutover because hybrid RRF ranges are volatile. Both candidates are
owned by the committed fixture and require private v2 tuning. If every candidate is
discarded, the existing no-evidence path runs and GPT-5.5 is not called.

Citation markers:

- `[D1]`, `[D2]`: controlled documents.
- `[A1]`, `[A2]`: conversation attachments.

The Sources panel groups these classifications visibly. Attachments are labelled
`Conversation attachment - not a controlled source`.

### 10.2 Mandatory grounding behavior

- Factual claims drawn from documents require an allowed citation marker.
- Citation markers are validated against the server-provided citation set.
- Unsupported markers are rejected rather than silently retained.
- If evidence is absent, Helmonic says it has insufficient permitted evidence.
- Hybrid nearest neighbours below the approved relevance cutoff count as absent.
- If sources conflict, Helmonic identifies the conflicting sources and does not choose
  one without a stated basis.
- Model-memory material cannot fill a document-evidence gap without a visible `[G#]`
  marker, and it cannot conceal the explicit no-document-evidence statement.

### 10.3 General context

When explicitly requested and feature-enabled, GPT-5.5 may add useful general knowledge
inside the same natural answer as controlled evidence. This is one model call, not a
second answer section or a second retrieval pipeline.

Marker namespaces remain visibly distinct:

- `[D1]`, `[D2]`: server-retrieved controlled documents.
- `[A1]`, `[A2]`: server-retrieved conversation attachments.
- `[G1]`, `[G2]`: the model's own general knowledge, unverified against the documents.

`G` markers are disclosure labels, not citations. They never create a source object,
never enter the Sources panel, and never pretend to identify a public reference. If any
`G` marker is present, the UI shows the persistent statement: `[G] marks the model's
own general knowledge, not verified against your documents.` Fully document-grounded
answers show neither `G` markers nor the disclaimer.

If retrieval returns no permitted document evidence, the answer must begin by stating
that the permitted Helmonic documents do not contain relevant evidence. General context
may follow with `G` markers, or the model must say that it does not know enough to answer
reliably. Unsupported `D`/`A` markers, malformed markers, non-sequential `G` markers,
and hidden no-evidence fallbacks fail validation.

The risk tradeoff is explicit: model memory is faster and avoids another resource, call,
and index, but it is not source-verified and can be wrong. This pathway does not satisfy
a request for independently sourced public evidence; that remains a separate future
capability with its own governance and approval gate.

### 10.4 Live web grounding

Live web grounding is a future, optional connector and remains disabled by default.
Microsoft states that Grounding with Bing traffic leaves the Azure compliance and Geo
boundary and is governed by separate terms. It therefore requires a separate legal,
data-governance, security, and cost decision.

If ever approved:

- confidential document content is never sent in a web query;
- project names, client names, addresses, measurements, and personal data are removed;
- the general answer remains structurally separate;
- Microsoft-required publisher and Bing query links are displayed as returned;
- the feature can be disabled by configuration without affecting document RAG.

## 11. Voice-input design

The initial experience is press-to-record rather than continuous listening:

1. User activates the microphone button.
2. Browser permission is requested explicitly.
3. A visible recording state and duration are shown.
4. Recording stops manually or at the configured maximum (proposed: 60 seconds).
5. Audio is sent to the same-origin API.
6. The server calls Azure Speech.
7. Transcript is inserted into the composer for review and editing.
8. The user sends the text through the normal query path.

Audio is not written to Blob or PostgreSQL by default. Logs contain duration and
request identifiers, not audio or transcript content.

The browser cannot directly access a private Azure endpoint. The Container App acts as
the server-side bridge. PAYG is active; Azure Speech provisioning remains blocked until
the resource, networking pattern, and specific deployment estimate are approved.

## 12. User experience

### 12.1 Conversation URLs

Persisted conversations use an addressable route such as:

```text
/consult/c/{conversationId}
```

Opening a recent item restores messages, attachment status, and historical citation
snapshots.

### 12.2 Sidebar

The `Recent` area becomes a folder tree supporting:

- create folder
- create subfolder
- rename
- move conversation
- soft delete
- expand/collapse
- loading, empty, and error states

The initial implementation uses an explicit `Move to folder` action. Drag-and-drop can
follow after keyboard and mobile behavior are verified.

### 12.3 Composer attachments

Each file chip displays:

- filename
- classification: conversation attachment
- progress/status
- duplicate/error explanation
- remove action
- retry action when safe

Questions can be sent while an attachment is processing, but the UI clearly states
that the document is not yet available for retrieval.

### 12.4 Sources panel

The Sources panel remains present for every Consult response. Selecting a historical
answer changes the panel to that answer's immutable citation snapshot.

It contains separate groups for controlled documents and conversation attachments. It
never contains general-context citations.

### 12.5 Inline general-knowledge disclosure

Document evidence and optional general knowledge render as one flowing assistant answer.
Inline `D`/`A` markers continue to resolve through the document-only Sources panel.
Inline `G` markers have no source card; whenever one appears, a persistent one-line
disclaimer immediately below the answer explains that it is model knowledge not
verified against the documents.

## 13. Identity and authorization

### 13.1 End user

- Microsoft Entra authentication remains required.
- The restriction remains exactly the two approved Entra object IDs for Ammar Ahsan and
  Jim Dunne.
- The source-IP allowlist remains in place.
- The server uses the trusted Entra object identifier as the ownership key.
- Anonymous requests and requests outside the network allowlist remain blocked.

### 13.2 Interactive Container App identity

Minimum responsibilities:

- read permitted controlled Search documents;
- read/write its application tables through a least-privilege database role;
- write new session blobs only through the upload service;
- send ingestion messages;
- read required Key Vault configuration.

It does not receive broad subscription or resource-group roles.

### 13.3 Ingestion job identity

A dedicated, persistent managed identity is recommended for the ongoing ingestion job.
It receives only:

- Blob data access to the required Consult containers;
- Search index data-contributor access to the required indexes;
- Service Bus receiver access to the ingestion queue;
- narrow PostgreSQL access to ingestion/document state.

It does not receive owner, contributor, database-owner, or search-service-management
rights for normal processing.

### 13.4 Migration identity

Database schema creation and migrations use a controlled migration identity or
administrator workflow. The runtime identity cannot create schemas, roles, or arbitrary
tables.

## 14. Runtime hardening

The tracked Tuesday exception that runs the application as root on port 80 must be
removed before Phase 1B uploads are exposed. The target runtime is:

- non-root user;
- port 8080;
- read-only application filesystem where practical;
- bounded temporary storage;
- no secrets baked into the image;
- current supported parsing libraries;
- request, extraction, and model timeouts;
- no document bodies in logs;
- dependency and container scanning in CI.

The ingestion parser should run in the worker boundary, not the interactive web
process.

## 15. Reliability and deletion

- Service Bus delivery is at-least-once; ingestion operations are idempotent by job ID
  and content hash.
- Retry uses bounded exponential backoff.
- Poison messages move to the existing dead-letter path for operator review.
- Search activation occurs only after complete chunk upload validation.
- Deletion is idempotent and removes active chunks before deleting the Blob.
- Database records retain only the minimum audit tombstone required by policy.
- Expiry processing is auditable and can resume after interruption.
- User-facing errors contain safe codes; detailed diagnostics remain server-side.

## 16. Observability

Structured telemetry includes:

- request ID
- conversation ID
- document/job ID
- lifecycle state transition
- duration
- page/chunk counts
- dependency status and safe error category
- model deployment identifier and token usage when available
- citation counts by classification

Telemetry excludes full prompts, extracted passages, document contents, audio, access
tokens, keys, and database credentials.

Operational dashboards and alerts are not required for the first code slice but the
event structure must support them.

## 17. Testing and acceptance criteria

### 17.1 Upload and ingestion

- A valid text PDF reaches `ready` and is retrievable in its conversation.
- Page numbers match the original PDF.
- A corrupt, encrypted, oversized, or wrong-type file is rejected safely.
- Duplicate behavior is deterministic.
- A processing failure never exposes partial chunks.
- A session attachment cannot be retrieved from another conversation.
- Promotion does not occur without explicit authorization.
- Expiry/delete removes Blob and active Search chunks.

### 17.2 Conversations and folders

- Refreshing the page restores the conversation.
- Create, rename, move, nest, and soft-delete work on desktop and mobile.
- Folder cycles and cross-owner references are rejected.
- Historical message citations remain unchanged after a source update.

### 17.3 Answers and citations

- Controlled citations use `D` markers.
- Attachment citations use `A` markers.
- General citations use `G` markers.
- General references never appear in the Sources panel.
- The Sources panel displays the citations for the selected answer.
- Unsupported citation markers fail validation.
- Insufficient and conflicting evidence produce explicit states.
- Retrieval-only mode remains usable if no model is configured.
- Naturally phrased Harold's Cross and Premier Inn questions retrieve the correct
  controlled evidence under v2.
- Wetherspoon questions do not return Premier Inn passages.
- The Wetherspoon 500 Hz bedroom-window case is a required live regression. The
  `--hyb71a81f4` validation run proved that the model correctly refuses to invent
  the value when Search returns Wetherspoon narrative pages but omits the table
  containing `54 dB`. The lexical normalizer now removes the generic words
  `scenario`, `level`, `predicted`, and `band`, leaving the precise hybrid query
  `future Wetherspoon bedroom window 500 Hz`; this must pass on a replacement
  zero-traffic revision before cutover.
- The subsequent `--hybdbdb74d` zero-traffic run proved the normalized query still
  returned the correct Wetherspoon page-7 atomic table chunk, but the generated
  answer correctly refused `54 dB`. Inspection of the approved source PDF found
  two structured tables on PDF page 7 totaling 1,875 compact characters, including
  `Noise Levels Impacting on Bedroom Window | 47 | 51 | 54` under the 125/250/500 Hz
  columns. The ingestion format appends those structured Markdown tables after a
  long narrative, while the runtime previously retained only the first 3,000
  characters. Table evidence now places the appended `Table 1` Markdown block
  first and uses remaining bounded space for narrative context. The 3,000-character
  limit is unchanged; both the 500 Hz/54 dB row and 66/47/19 dB comparison have
  regression coverage. The run stopped after this first failure; no remaining
  cases or traffic shift were attempted. The failed candidate was then deactivated
  with zero replicas, its temporary Entra callback was removed, and Azure was read
  back to confirm the sole permanent callback and 100% traffic on `--p1bgpt55fin`.
- The replacement `--hyb570514c` candidate passed all eight live cases. In particular,
  it answered the table regression as 54 dB, answered the background comparison as
  66 dB versus 47 dB/19 dB with no Premier Inn contamination, and returned no evidence
  under a server-authoritative unauthorized permission scope. A later separate approval
  moved v2 through 10%, 25%, 50%, and 100% traffic stages without errors; v1 remains
  active at 0% for rollback.
- Subjective sound, population, and recipe questions remain no-evidence after vector
  candidates are thresholded.
- An in-corpus question under an unauthorized permission scope returns no results, and
  the request contract proves `preFilter` is applied before vector scoring.

### 17.4 Speech

- Microphone consent, denied permission, timeout, empty audio, and unsupported browser
  states are handled visibly.
- Audio is not persisted by default.
- Transcript is editable before submission.
- The feature remains disabled when Speech configuration is absent.

### 17.5 Security

- Anonymous and unauthorized users remain blocked.
- Wrong-IP access remains blocked.
- CORS remains disabled.
- Blob containers remain non-public.
- Browser requests cannot choose another owner ID.
- Runtime and worker identities pass least-privilege review.
- The deployed application runs non-root on port 8080.

## 18. Deployment strategy

1. Complete local code, unit/integration tests, and documentation.
2. Reconfirm usable quota in France Central or Sweden Central and approve the new EU
   account/private endpoint, embedding, Search/semantic, and private validation costs
   before creating anything. North Europe must not be used because its live inventory
   does not offer the selected model as `DataZoneStandard`.
3. Deploy the embedding model and build a non-root image through the existing paths.
4. Validate the full extraction-v2 payload, embed every chunk, prove v1 parity, create
   `consult-demo-v2`, upload, and prove v2 parity without changing v1.
5. Apply backward-compatible database migrations through the controlled migration
   workflow.
6. Provision/configure the ingestion job and its identity only after cost approval.
7. Deploy a new revision at zero traffic with `consult-demo-v2`, hybrid/semantic flags,
   embedding configuration, and explicit immutable image.
8. Validate `/healthz`, `/readyz`, authentication, network restrictions, parity, the
   eight retrieval cases, generated answers, citations, and no-evidence behavior.
9. Keep v1 and the current revision available for rollback.
10. Move traffic only after a separate costed approval.
11. Rehearse the full authenticated flow repeatedly.

Database changes must be backward compatible with the rollback revision. Destructive
migrations are deferred until all older revisions are retired.

Vercel is not changed and is not connected to these APIs.

## 19. Cost and approval boundaries

The estimates below are incremental and exclude the existing Azure baseline, previously
estimated at approximately USD 130-145 per month after conversion to PAYG.

| Work item | New fixed cost | Initial validation ceiling | Approval boundary |
| --- | ---: | ---: | --- |
| Local design, code, tests, documentation | USD 0 | USD 0 | Repository changes only |
| Read-only 300 GB corpus inventory | USD 0 | USD 0 | Local/share reads only; no Azure call and no source mutation |
| Read-only PST metadata inventory | USD 0 | USD 0 | Local metadata reports only; no body/attachment content, Outlook profile, source write, or Azure call |
| PostgreSQL schema and persistence | None on existing server | USD 0.05 | Migration and Azure validation |
| Additional Blob containers | None | Less than USD 0.01 at initial scale | Container creation and validation |
| Additional Search indexes | None on existing Search service | Included with ingestion ceiling | Index creation and ingestion |
| Separate EU Foundry account for embeddings | No standing account charge; France Central account created after quota confirmation | USD 0 before inference | Approved and provisioned; public access disabled |
| Embedding-account private endpoint and DNS | Approximately USD 7.80/month plus negligible data processing; dedicated `privatelink.openai.azure.com` zone linked to the DEV VNet | Included in the USD 0.30 hybrid validation ceiling | Approved, provisioned, private-endpoint-only, and proven through the completed explicit-UAMI private validation |
| `text-embedding-3-small` Data Zone Standard | Usage based; no standing model charge; version 1/capacity 1 deployed | USD 0.05 conservative initial embedding ceiling | Approved for the current private validation only |
| Semantic ranker for hybrid cutoff | No new fixed charge on existing Search Basic; its current free semantic plan includes the first 1,000 requests/month | Included in the USD 0.30 hybrid validation ceiling | v2 semantic configuration, evaluation, and live queries |
| Initial 16-PDF hybrid ingestion validation | None fixed | USD 0.25 | Job execution, storage, Search transactions |
| Container Apps ingestion job | No minimum while idle on consumption | Included above initially | New resource/configuration and executions |
| Standing ingestion UAMI and three scoped role assignments | USD 0 fixed | USD 0.05 approved hard ceiling; synthetic proof completed | UAMI/roles retained; disposable job/data/image removed; temporary path retained as fallback |
| Azure Speech S0 usage | Usage based | Approximately EUR 0.88/audio hour | Provision only after separate resource/cost approval |
| Speech private endpoint | Approximately EUR/USD 7-8 monthly | Under EUR/USD 0.10 demo usage | Separate recurring-cost approval |
| Curated general-source ingestion | None fixed on existing services | USD 0.25 per initial batch | Source approval and ingestion |
| Language model | Variable token usage | To be calculated for chosen deployment | Separate model deployment approval |
| Grounding with Bing | USD 14/1,000 transactions plus model tokens | Not approved | Separate legal, governance, and cost approval |

OCR, Defender for Storage, another private endpoint, a larger Search SKU, increased
replicas/partitions, PostgreSQL scaling, or any other cost-bearing service is outside
these estimates and requires a separate proposal and explicit approval.

## 20. Delivery slices

### Phase 1B-A: foundation

- documentation baseline
- non-root/8080 remediation
- database migrations and data-access layer
- persistent conversations/messages
- sidebar folders/subfolders
- feature flags and API contracts

Estimated engineering scope: 4-7 working days.

### Phase 1B-B: session documents

- real PDF upload
- Blob separation
- Service Bus ingestion
- isolated worker
- page-preserving extraction
- session Search index
- attachment citations
- delete, retry, duplicate, expiry, and promotion behavior

Estimated engineering scope: 4-7 working days.

### Phase 1B-C: voice and general context

- voice UI and disabled Speech adapter
- feature-gated single-call inline general knowledge with `G` disclosure markers
- document-only Sources panel plus conditional persistent `G` disclaimer
- model/Speech deployment after quota, compliance, architecture, and cost approvals

Estimated engineering scope: 4-7 working days after model availability.

These are planning ranges rather than delivery commitments. Each slice is independently
testable and deployable behind feature flags.

## 21. Required decisions before Azure implementation

1. Session-upload retention period: proposed 30 days.
2. Initial maximum PDF size: 40 MB in the local contract; review before live activation.
3. Whether Phase 1B requires malware scanning before production use.
4. Who can promote attachments into the controlled knowledge base.
5. Azure Speech S0/private-endpoint recurring cost approval now that PAYG is active.

## 22. Documentation discipline for every change

This file remains the single comprehensive architecture, component, decision, status,
roadmap, security, deployment, operations, and cost reference. Phase 1B must not split
those subjects into disconnected documents that can drift independently.

Every implementation commit or working session must update, where applicable:

1. **Architecture overview** - new service, trust boundary, request path, identity,
   storage/index, model, or deployment behavior.
2. **File and component map** - every created, removed, renamed, or repurposed file.
3. **Decision log** - the chosen option, rejected alternatives, and reason.
4. **Current status** - what is implemented locally, committed, pushed, deployed,
   validated, blocked, disabled, or tracked as debt.
5. **Access points** - any changed worktree, branch, PR, resource, index, container,
   revision, or URL.
6. **Cost and approval boundaries** - estimates, approvals, actual validation ceilings,
   recurring charges, quota, and subscription changes.
7. **Acceptance criteria and runbook behavior** - how the capability is verified,
   failed safely, rolled back, and cleaned up.

`README.md` remains the short repository entry point and links here. `.env.example`
remains the non-secret configuration contract. Focused source-adjacent instructions,
such as `scripts/ingestion/README.md`, may explain how to operate that exact component,
but they cannot replace or contradict this reference. The historical runtime-exception
record remains until its non-root/8080 exit gate is closed.

Commit messages must state what changed and why. Code and its documentation are
committed and pushed together. A documentation-only correction is allowed when it fixes
an identified inaccuracy, but documentation catch-up after an implementation has
already moved ahead is not the normal workflow.

## 23. October controlled-corpus discovery runbook

The first production-deadline action is a local, non-mutating discovery run, not a bulk
Azure ingestion. Run `scripts/corpus_audit/run-corpus-audit.ps1` from a normal Windows
PowerShell session that can open `S:\z_Helmonic_iAcoustics`. The default `all` mode reads
every PDF page and is the authoritative OCR input; `sample` is permitted only for an early
duration/volume estimate. An interrupted run resumes unchanged files from local SQLite.

The review gate requires all of the following before ingestion-pipeline capacity or OCR
is proposed:

1. PDF and Word counts and bytes by checklist/top-level folder.
2. Broken, encrypted, legacy-conversion, and scan-error lists.
3. Exact SHA-256 duplicate groups separated from possible filename variants.
4. Full and partial OCR-candidate counts, percentages, and a representative human spot
   check that removes blank/drawing false positives.
5. Explicit classification of `IA-21` and Cadna/specialist material.
6. A human-confirmed highest-value batch order; the audit does not invent business value.
7. A scaled evaluation plan for each batch, including paraphrase recall, numeric/table
   accuracy, permission filtering, citations, and no-evidence correctness.

Only metadata and classifications are written locally under the ignored
`local-artifacts/corpus-audit` directory. No source content, extracted text, credentials,
or audit output is committed. After this gate, the standing Phase 1B pipeline remains:
Service Bus -> dedicated least-privilege worker -> page-preserving/table-aware extraction
and Word rendering -> optional approved OCR -> chunk/embed -> versioned Search index ->
proportional retrieval/generated-answer evaluation. New Azure resources, capacity changes,
OCR usage, or material ingestion runs still require an estimate and explicit approval.

## 24. PST metadata-only discovery runbook

This track does not reuse the PDF/Word extractor and does not attach archives to
Outlook. Run `scripts/pst_audit/run-pst-metadata-audit.ps1 -Build` from a normal Windows
PowerShell session that can open `S:\z_Helmonic_iAcoustics`. Default discovery is
intentionally non-recursive and accepts exactly one `backup_glen*.pst`, exactly one
`backup_owen*.pst`, and at most one optional `*jim*.pst` at the share root. Any ambiguity
stops for an explicit path rather than guessing.

The report gate requires per-mailbox and per-folder email counts, date ranges, message
header/recipient metadata, attachment count/name/type metadata, declared volume, and
reported parser/count discrepancies. PST physical size and metadata-declared message/
attachment size are kept distinct because PST indexes and unused allocation prevent an
exact folder-size allocation without reading more data. Jim's absence is recorded as
pending while Glen and Owen proceed.

All outputs remain local under ignored `local-artifacts/pst-audit`. They contain personal
metadata and must not be committed or uploaded. Completion of this run allows sizing and
selection only. It does not authorize body extraction, attachment opening, OCR, Azure
ingestion, model inference, or any resolution of the still-open third-party consent/
lawful-basis question.

