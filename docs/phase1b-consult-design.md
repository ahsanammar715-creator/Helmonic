# Helmonic Consult Living Reference

Status: Authoritative living reference for the active Phase 1A/1B branch

Last reviewed: 26 August 2026

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
| Current real revision | `ca-helmonic-consult-dev-002--p1b69b6b7a` (`helmonic-consult:69b6b7af9283657c9f509385fcb2050ab01c65c4`), 100% traffic, non-root UID 1000, port 8080 |
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
| Controlled-source Search index | `consult-demo-v1` |
| Service Bus namespace | `sb-helmonic-dev-001` |
| Service Bus queue | `consult-ingestion` |
| Foundry account | `aif-helmonic-dev-001` |
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
  consult-demo-v1
        |
        +--> no evidence: explicit insufficient-evidence response
        |
        +--> evidence: retrieval-only response + Sources panel
        |
        `--> future Model Gateway: grounded generated answer
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
public API. The current `src/lib/server/model.ts` is the initial direct Azure adapter;
Phase 1B evolves it into a gateway that:

- exposes one internal answer interface to Consult;
- selects only explicitly configured Azure deployments;
- supports a primary model and a deliberately configured secondary path;
- keeps retrieval-only Target B available when no model is usable;
- separates document-answer calls from general-context calls;
- prevents confidential evidence from reaching public-web connectors;
- validates citation markers against server-provided sources;
- records model/deployment identifiers, latency, token usage, and safe failure reasons;
- enforces per-request limits and future cost budgets;
- uses managed identity for Azure model access.

There is no approved model deployment at present. The gateway must degrade to
retrieval-only behavior without weakening evidence or citation controls.

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
| `.env.example` | Non-secret Phase 1A runtime configuration contract and optional model placeholders |
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
| `scripts/evaluation/consult-retrieval.json` | Versioned retrieval-relevance cases, including known-project matches and mandatory no-evidence cases |
| `scripts/evaluation/run-consult-retrieval.mjs` | Offline suite/policy validation and opt-in managed-identity live Search evaluation |
| `scripts/evaluation/run-consult-generated.mjs` | Offline citation-policy validation and opt-in five-case live Target A evaluation through the same-origin Consult API |

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
| `src/app/api/consult/query/route.ts` | Same-origin Consult query API, controlled/session Search orchestration, retrieval-only/model modes, and isolated general-context response contract |
| `src/app/api/consult/conversations/route.ts` | Owner-scoped list/create API for persistent Consult conversations; disabled until Phase 1B persistence activation |
| `src/app/api/consult/conversations/[conversationId]/documents/route.ts` | Authenticated, owner-scoped PDF upload endpoint that streams to session Blob and queues ingestion |
| `src/app/api/consult/folders/route.ts` | Owner-scoped list/create API for nested Consult folders |
| `src/app/api/consult/folders/[folderId]/route.ts` | Owner-scoped folder rename API |
| `src/app/healthz/route.ts` | Process/liveness response plus runtime UID/non-root evidence on supported operating systems |
| `src/app/readyz/route.ts` | Managed-identity dependency readiness response |

### Consult and shared UI components

| Path | Responsibility |
| --- | --- |
| `src/components/consult/ConsultWorkspace.tsx` | Live Consult state, query/conversation/upload calls, answer-mode rendering, and active document/general citations |
| `src/components/consult/GeneralContextSection.tsx` | Dedicated general-context surface using only `G` citations and never the document Sources panel |
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
| `src/lib/consult/types.ts` | Consult document-answer, document/attachment citation, and isolated general-context response contracts |
| `src/lib/consult/corpus.ts` | Single application source of truth for the current controlled-document count and label |
| `src/lib/consult/search-policy.ts` | Pure precision-first controlled Search request policy shared by runtime and evaluation tooling |
| `src/lib/consult/model-policy.ts` | Pure fail-closed `D`/`A` document-answer marker validator shared by the runtime contract |
| `src/lib/consult/organization.ts` | Folder/conversation persistence DTOs |
| `src/lib/consult/uploads.ts` | Session-document lifecycle and composer attachment DTOs |
| `src/lib/server/config.ts` | Runtime environment parsing, defaults, and completeness checks |
| `src/lib/server/azure-credential.ts` | Managed-identity/default Azure credential token acquisition |
| `src/lib/server/search.ts` | Permission-scoped controlled and owner/conversation-scoped session Search queries and citation shaping |
| `src/lib/server/model.ts` | Managed-identity Azure GPT implementation of the Model Gateway with high reasoning, bounded output, strict document-marker validation, and usage telemetry |
| `src/lib/server/model-gateway.ts` | Provider-neutral document/general request contracts, validation error boundary, and `G` citation validation seed |
| `src/lib/server/postgres.ts` | Managed-identity PostgreSQL connection wrapper used by readiness and repositories |
| `src/lib/server/consult-repository.ts` | Transactional, owner-scoped folder, conversation, upload, and ingestion-job persistence |
| `src/lib/server/identity.ts` | Platform-authenticated actor extraction from Container Apps auth headers |
| `src/lib/server/session-blob.ts` | Single-pass PDF signature/hash validation and managed-identity Blob streaming |
| `src/lib/server/service-bus.ts` | Managed-identity REST dispatch for versioned session-ingestion messages |
| `src/lib/server/readiness.ts` | Search, PostgreSQL, Blob, Key Vault, and optional model checks |
| `src/lib/data.ts` | Original illustrative/mock data; not authoritative backend data |
| `src/lib/useSessionBoolean.ts` | Session-only panel preference helper |
| `src/lib/workspaceTheme.ts` | Workspace color/theme mapping |
| `src/lib/theme.ts` | Shared theme definitions |
| `src/lib/currency.ts` | Shared currency display helpers |

### Controlled ingestion

| Path | Responsibility |
| --- | --- |
| `scripts/ingestion/index-schema.json` | Current `consult-demo-v1` Search schema |
| `scripts/ingestion/session-index-schema.json` | Proposed isolated, owner/conversation-filterable `consult-session-v1` Search schema |
| `scripts/ingestion/payload.example.json` | Non-sensitive example of the source/chunk/page/hash ingestion payload contract |
| `scripts/ingestion/README.md` | Operator instructions, current corpus-count gate, and least-privilege separation for controlled ingestion |
| `scripts/ingestion/upload-payload.mjs` | Controlled 16-document Blob/Search writer, validation, and verification path |
| `scripts/validation/phase1b-bootstrap.cjs` | Temporary private-network validation job entrypoint for the idempotent Phase 1B migration plus isolated Blob container/Search index creation |
| `scripts/validation/phase1b-validation-maintenance.cjs` | Private-environment audit, retrieval evaluation, and tightly scoped synthetic-fixture cleanup used during Phase 1B validation |
| `scripts/validation/phase1b-postgres-owner-recovery.cjs` | One-purpose cleanup utility that transfers bootstrap-created PostgreSQL object ownership to the permanent Entra administrator before deleting a temporary bootstrap principal |
| `scripts/deployment/set-consult-template.ps1` | Fail-closed zero-traffic deployment helper requiring an immutable image SHA and explicit feature flags; it sets the complete Target A model/readiness contract when provided and removes all model variables for Target B, refuses single-revision mode, and verifies the new revision receives no traffic |
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
does not answer from hidden model memory, fabricate a source, or treat general context
as document evidence.

### D-005: citations are server-authoritative

The server creates citation objects from Search results. The model can reference only
provided markers. The Sources panel displays real document/page evidence. Phase 1B adds
separate `D`, `A`, and `G` marker namespaces so controlled documents, conversation
attachments, and general references cannot be blended.

Target A is fail-closed: the Model Gateway rejects an empty answer, an answer without a
document marker, an unsupported `D`/`A` marker, or any `G`/numeric marker in the document
answer. It does not silently remove an invalid marker or append a citation the model did
not actually use. The no-evidence branch returns before the Model Gateway is invoked.

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

### D-009: general context is additive and isolated

The controlled-document answer remains primary. General context uses a separate source
set, model call, response object, UI block, and citation namespace. Live Bing grounding
stays disabled because Microsoft documents that its queries leave the Azure
compliance/Geo boundary.

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
documents retain `D` citations; general references use `G` citations and never enter
the Sources panel. The migration, session container/index, worker, feature activation,
deployment, and traffic shift remain separate cost/approval gates.

### D-020: every Container Apps revision uses an explicit immutable template

Revision creation must specify the immutable image SHA and the uploads, folders, and
general-context feature flags together. `scripts/deployment/set-consult-template.ps1`
enforces those inputs, refuses single-revision mode, and verifies that a newly created
revision receives zero traffic. Operators must not use an image-only or flag-only
update that silently inherits Azure's previous latest-revision template.

## Current status

### Live and working

- Target A revision `--p1bgpt55fin` receives 100% of live traffic through application
  ingress port 8080. It uses immutable image
  `helmonic-consult:78f31b938591daefae58c42de0f2d8fcb478c334`, runs as UID 1000,
  and keeps minimum replicas at zero.
- Azure Portal independently reconfirmed the persisted traffic weights on 26 August
  2026: `--p1b69b6b7a` 100%, `--ca72a0c` 0%, and `--0000001` 0%.
- The prior hardened revision `--p1b69b6b7a` remains active at 0% as the immediate
  Target B rollback. The older root/port-80 revision and placeholder remain available;
  a rollback to `--ca72a0c` must restore ingress port 80 as well as its traffic weight.
- Platform authentication is enabled and restricted to exactly Ammar Ahsan
  (`c34341a3-7783-44d7-8980-b6ea8111bc06`) and Jim Dunne
  (`84889a68-5ca1-40d6-860b-7654b6f100ce`).
- The source-IP allowlist is active for `86.43.74.56/32`.
- The user has successfully signed in and reached the application.
- CORS is disabled and Vercel is outside the real data path.
- Sixteen controlled iAcoustics PDFs have been ingested.
- Blob originals and page-preserving Search chunks exist.
- `consult-demo-v1` retrieval works and returns document/page citations.
- The five-case private retrieval suite passes against live Azure Search: four
  known-evidence questions return only the expected Harold's Cross, Premier Inn, and
  Wetherspoon's Camden Street evidence, while the France question correctly returns no
  permitted evidence. The Wetherspoon case specifically confirms the former unrelated
  Premier Inn relevance leak is closed.
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
- A provider-neutral Model Gateway contract and a separate general-context UI use only
  `G` citations and never populate the controlled Sources panel.
- The document-answer route now invokes the provider-neutral Model Gateway rather than a
  provider function directly. Its Azure GPT implementation uses managed identity, high
  reasoning, a 2,000-token reasoning/output ceiling, strict marker validation, and
  content-free token/citation telemetry. The five-case generated-answer evaluator passes
  both its offline policy contract and the private live Target A path.
- The migration, isolated Blob container, and session Search index are now applied in
  DEV. The session-upload worker, Azure Speech resource, sidebar activation, upload
  activation, and general-context activation remain unimplemented or disabled; the
  separately approved Target A model path is the only newly activated Phase 1B feature.

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
  plus isolated session container/index are applied. The ingestion worker, sidebar tree
  activation, live feature flags, and any traffic shift remain pending separate approval.
  Voice deployment is no longer account-tier-blocked, but Azure Speech resource creation
  remains pending a separate cost estimate and approval.
- Azure Speech has not been provisioned.
- No live-web/general-context connector has been approved.

### Tracked technical debt and risks

- The root/port-80 revision is no longer on the live request path, but remains active at
  0% as an intentional rollback option. Full exception closure requires deactivation.
- The application copy now uses one centralized sixteen-document corpus constant. It
  will need to move to server-provided corpus metadata when arbitrary controlled-source
  administration is introduced.
- A five-case retrieval evaluation set now guards known-project relevance and
  no-evidence behavior. The runtime uses `searchMode: all` across title, section, and
  content so a missing project term cannot match only generic question words. The
  26 August live evaluation found a blocking serialization defect before rollout: the
  Search REST API expects `searchFields` as one comma-separated primitive string. The
  first 27 August private rerun proved that serialization was fixed but returned zero
  results for all three expected-evidence questions because raw interrogative/filler
  terms were still required by `searchMode: all`; both no-evidence cases passed. Source
  runtime now normalizes questions to their content-bearing terms while preserving the
  permission filter and `all`-term precision. Validation image `9117dfa` passed the
  corrected five-case private suite on 27 August: four expected-evidence cases returned
  their correct projects and the no-evidence case behaved as expected. The live
  relevance gap is closed; no Phase 1B traffic promotion was part of that validation.
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

Azure operational changes after `ca72a0c` were performed under explicit approvals but
did not all have corresponding source commits because they were configuration/data
operations. Going forward, every such operation must update this chronology and current
status in the same working session and be committed/pushed with the related application
or infrastructure record.

## 1. Purpose

Phase 1B extends the proven Phase 1A Consult vertical slice into a persistent,
user-operated document workspace. It adds real document attachment and ingestion,
persistent conversations and folders, speech-to-text input, and a strictly separated
general-context capability.

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

### 3.2 Initially out of scope

- Automatic ingestion of arbitrary websites.
- Unrestricted live-web search under the current EU-only governance posture.
- Automatic email or external messaging.
- Autonomous promotion of attachments into the controlled knowledge base.
- OCR for scanned/image-only PDFs.
- DOCX and CSV ingestion where mandatory page citations cannot be guaranteed.
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
        +--> Azure AI Search
        |      controlled index, session index, curated-general index
        |
        +--> EU model deployment (pending quota/approval)
        |      document-grounded answer and general-context answer
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

- `consult-demo-v1`: existing controlled organizational documents.
- `consult-session-v1`: temporary, conversation-scoped attachments.
- `consult-general-v1`: curated authoritative public references.

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

The existing controlled index retains its permission-scope filtering. Phase 1B adds
document/version status where required so incomplete or superseded chunks cannot be
returned.

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

The response is structurally separated:

```json
{
  "requestId": "uuid",
  "documentAnswer": {
    "status": "generated | retrieval-only | insufficient-evidence",
    "text": "string or null",
    "citations": []
  },
  "generalContext": {
    "status": "generated | unavailable | insufficient-evidence | disabled",
    "text": "string or null",
    "citations": []
  }
}
```

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
- If sources conflict, Helmonic identifies the conflicting sources and does not choose
  one without a stated basis.
- General-context material cannot be used to fill a gap in the document-grounded
  section without being visibly classified as general context.

### 10.3 General context

General context is generated through a separate retrieval and model call. This is a
deliberate isolation boundary; it reduces the risk that public material is presented as
if it came from the user's documents.

Citation markers:

- `[G1]`, `[G2]`: curated public references.

General citations never enter the Sources panel. They appear only inside a separate
`General context - not from your documents` component.

The primary Phase 1B source is the EU-hosted `consult-general-v1` curated reference
index. Sources must be authoritative, allowlisted, traceable, and retained with their
real public URLs and content hashes.

The model is not permitted to invent or complete a URL. If retrieval provides no
verified public reference, general context is marked insufficient or unavailable.

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

### 12.5 General-context component

The general section appears below the document-grounded answer with a distinct border,
heading, explanatory label, citation markers, and uncertainty state. It is never shown
as a continuation of the document answer.

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
2. Build a non-root image through the existing GitHub/ACR path.
3. Apply backward-compatible database migrations through the controlled migration
   workflow.
4. Provision/configure the ingestion job and its identity only after cost approval.
5. Deploy a new Container Apps revision at zero traffic.
6. Validate `/healthz`, `/readyz`, authentication, network restrictions, persistence,
   upload, ingestion, retrieval, and citation separation.
7. Keep the current revision available for rollback.
8. Move traffic only after a separate costed approval.
9. Rehearse the full authenticated flow repeatedly.

Database changes must be backward compatible with the rollback revision. Destructive
migrations are deferred until all older revisions are retired.

Vercel is not changed and is not connected to these APIs.

## 19. Cost and approval boundaries

The estimates below are incremental and exclude the existing Azure baseline, previously
estimated at approximately USD 130-145 per month after conversion to PAYG.

| Work item | New fixed cost | Initial validation ceiling | Approval boundary |
| --- | ---: | ---: | --- |
| Local design, code, tests, documentation | USD 0 | USD 0 | Repository changes only |
| PostgreSQL schema and persistence | None on existing server | USD 0.05 | Migration and Azure validation |
| Additional Blob containers | None | Less than USD 0.01 at initial scale | Container creation and validation |
| Additional Search indexes | None on existing Search service | Included with ingestion ceiling | Index creation and ingestion |
| Initial 10-20 text-PDF ingestion validation | None fixed | USD 0.25 | Job execution, storage, Search transactions |
| Container Apps ingestion job | No minimum while idle on consumption | Included above initially | New resource/configuration and executions |
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
- curated public-reference index
- separate general-context generation
- separate general-citation rendering
- model/Speech deployment after quota, compliance, architecture, and cost approvals

Estimated engineering scope: 4-7 working days after model availability.

These are planning ranges rather than delivery commitments. Each slice is independently
testable and deployable behind feature flags.

## 21. Required decisions before Azure implementation

1. Session-upload retention period: proposed 30 days.
2. Initial maximum PDF size: 40 MB in the local contract; review before live activation.
3. Whether Phase 1B requires malware scanning before production use.
4. Who can promote attachments into the controlled knowledge base.
5. Which authoritative public domains/sources are permitted in the curated general
   index.
6. Selected EU model and approved token budget after quota becomes available.
7. Azure Speech S0/private-endpoint recurring cost approval now that PAYG is active.

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
