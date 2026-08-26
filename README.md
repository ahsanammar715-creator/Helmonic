# Helmonic

> **Active Consult engineering reference:** the current Azure architecture, security
> model, deployment status, decision log, Phase 1B roadmap, and cost controls are
> maintained in [`docs/phase1b-consult-design.md`](docs/phase1b-consult-design.md).
> The UI-baseline description below predates the Phase 1A Azure runtime and must not be
> used as the current deployment status.

[![CI](https://github.com/ahsanammar715-creator/Helmonic/actions/workflows/ci.yml/badge.svg)](https://github.com/ahsanammar715-creator/Helmonic/actions/workflows/ci.yml)

This repository contains the approved Helmonic Next.js application: the landing page,
Consult, Build, Logistics, and Growth workspaces, plus the Phase 1A Azure-backed Consult
runtime.

Consult now has a real same-origin server API, managed-identity Azure access, private
Blob/Search/PostgreSQL/Key Vault paths, retrieval from the controlled
`consult-demo-v1` index, and server-authoritative document/page citations. When no
approved model deployment is configured, it fails safely to retrieval-only mode.

Build, Logistics, Growth, and the older Consult project/report demonstrations continue
to use illustrative local/mock state. Persistent conversations, real browser uploads,
folders, voice input, and separately cited general context are designed for Phase 1B
but are not implemented yet.

## Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) for icons
- [Playwright](https://playwright.dev/) for end-to-end tests
- [Azure Identity](https://www.npmjs.com/package/@azure/identity) for managed-identity tokens
- [node-postgres](https://node-postgres.com/) for PostgreSQL readiness and future persistence

## Implemented UI

- Landing page (hero, prompt bar with workspace chooser, Founders' Vision modal)
- Consult (empty state, conversational new-project flow, Section 4 report preview)
- Build (empty state, in-chat cost estimator with live spec/BOM, Export BOM, printable BOM sheet)
- Logistics (conversational trip planning, scenario comparison, budget-linked approval)
- Growth → Marketing (conversation + collapsible Drafts panel, version history)
- Growth → Lead Generation, split into two internal business-line modes:
  - Smart Studio (European/Smart Studio lead research — research funnel, ranked list,
    company intelligence panel)
  - iAcoustics Planning Signals (Ireland-first — scans mock Irish planning activity via
    BuildingInfo for acoustic RFIs and noise-related planning conditions, ranks fit, and
    separates the source fact — e.g. "Acoustic Trigger" — from Helmonic's analysis and
    the parties involved, including the architect)
- Growth → Tender Intelligence (iAcoustics, Ireland-wide public procurement — scans mock
  tender notices from eTenders, TED, local authorities and public bodies like the OPW,
  ranks fit, and separates tender facts/evidence from Helmonic analysis in a right-side
  panel; "Send to Consult" hands a selected opportunity to Consult's new-project flow)
- Responsive/mobile behaviour (sidebar collapses to a bottom tab bar, side panels hide)
- The original product-demonstration flows remain interactive and mock-driven. The main
  `/consult` route is the exception: it calls the real same-origin Phase 1A API when
  `HELMONIC_RUNTIME=azure`.

## Requirements

- Node.js **22.22.2** (tested version — see `.nvmrc`)
- npm 10+

## Installation

```bash
git clone https://github.com/ahsanammar715-creator/Helmonic.git
cd Helmonic
npm ci
```

(`npm ci` installs exactly what's in `package-lock.json`; use `npm install` only if you
need to change dependencies.)

## Run locally

```bash
npm run dev
```

Open **http://localhost:3000**.

## Production build

```bash
npm run build
npm run start
```

Also served at **http://localhost:3000**.

## Validation

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint
npm run build       # Next.js production build
npm run test:e2e    # Playwright end-to-end tests (starts its own prod server)
```

There is no unit-test suite in this repository yet — the UI is presently covered by the
Playwright end-to-end suite in `tests/e2e/`, which exercises every route and the main
interactive flows (prompt routing, the Consult wizard, the Build cost estimator, Lead
Generation research, and mobile layout).

## Environment variables

Local UI-only development requires no Azure configuration. The Azure-backed Consult
runtime uses the non-secret configuration names documented in [`.env.example`](.env.example).
Azure credentials, keys, passwords, and connection strings must not be committed.

## Repository structure

```
src/app/                    Next.js App Router routes
  page.tsx                  Landing page
  (workspace)/               Route group sharing the sidebar + mobile tab bar layout
    consult/                 Consult workspace (empty state, new-project flow, report)
    build/                   Build workspace (empty state, cost estimator, BOM sheet)
    logistics/                Logistics workspace
    growth/                   Growth workspace (Marketing, Lead Generation, Tender Intelligence)
src/components/              Shared UI: Sidebar, TopBar, SourcesPanel, chat bubbles, etc.
src/lib/                     Mock data (src/lib/data.ts) and small shared hooks
public/images/                Static assets (hero photo)
tests/e2e/                   Playwright end-to-end tests
playwright.config.ts         Playwright configuration
```

## Mock and live data boundaries

Illustrative project details, transcripts, BOM items, logistics scenarios, lead data,
and tender/planning demonstrations live in [`src/lib/data.ts`](src/lib/data.ts) and
local React state. Panel preferences use `sessionStorage` through
[`src/lib/useSessionBoolean.ts`](src/lib/useSessionBoolean.ts).

The primary `/consult` route instead calls `/api/consult/query`. The server queries the
permitted Azure AI Search index and returns shaped citation objects. Controlled source
PDFs and extracted payloads are never committed to this repository.

## Current limitations

- No persistent conversations, messages, folders, or subfolders yet.
- The attachment control is filename-only and does not upload file bytes.
- No approved language-model deployment is active; live Consult is retrieval-only.
- The active demo container has a tracked temporary root/port-80 exception that must be
  removed before Phase 1B uploads or broader exposure.
- The committed historical ingestion script covers exactly five documents while the
  controlled live corpus contains sixteen; Phase 1B must make ingestion reproducible.
- No automated unit-test suite exists yet; current automated coverage is Playwright E2E.
- Lead Generation, Logistics, Marketing, Build, and legacy Consult-project data remains
  illustrative/mock rather than live research or transactional data.

## Next engineering phase

Phase 1B is designed but not implemented. It introduces:

- persistent Consult conversations and nested sidebar folders;
- real PDF upload to a conversation-scoped Blob container;
- asynchronous, page-preserving ingestion into a separate session Search index;
- explicit promotion from temporary attachments to controlled sources;
- Azure Speech input behind a disabled feature flag until PAYG approval;
- a Model Gateway and strictly separate, properly cited general-context section;
- non-root port 8080 runtime remediation before live upload exposure.

See the [living reference](docs/phase1b-consult-design.md) for the authoritative plan,
security model, resource inventory, decisions, current status, and cost gates.
