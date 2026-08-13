# Helmonic

[![CI](https://github.com/ahsanammar715-creator/Helmonic/actions/workflows/ci.yml/badge.svg)](https://github.com/ahsanammar715-creator/Helmonic/actions/workflows/ci.yml)

This repository contains the **approved Helmonic frontend / UI implementation** — a
Next.js application implementing the Helmonic v4 product design (landing page, Consult,
Build, Logistics, and Growth workspaces). It runs entirely on **local/mock application
state**: there is no backend, database, or live API behind it yet.

**Not implemented in this repository (future engineering phases):**

- Production backend
- PostgreSQL / persistent storage
- Vector database / RAG
- Authentication
- Live third-party APIs (maps, travel, research, etc.)
- Cloud infrastructure / deployment
- WordPress integration

## Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/) for icons
- [Playwright](https://playwright.dev/) for end-to-end tests

## Implemented UI

- Landing page (hero, prompt bar with workspace chooser, Founders' Vision modal)
- Consult (empty state, conversational new-project flow, Section 4 report preview)
- Build (empty state, in-chat cost estimator with live spec/BOM, Export BOM, printable BOM sheet)
- Logistics (conversational trip planning, scenario comparison, budget-linked approval)
- Growth → Marketing (conversation + collapsible Drafts panel, version history)
- Growth → Lead Generation (research funnel, ranked list, company intelligence panel)
- Growth → Tender Intelligence (iAcoustics, Irish market only — scans mock tender
  notices, ranks fit, and separates tender facts/evidence from Helmonic analysis in a
  right-side panel; "Send to Consult" hands a selected opportunity to Consult's
  new-project flow)
- Responsive/mobile behaviour (sidebar collapses to a bottom tab bar, side panels hide)
- All flows above are interactive, driven by local React state and mock data — nothing
  is persisted or sent to a server

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

None required. This is currently a frontend-only application with no backend calls, so
there is no `.env.example` in this repository — one will be added when a real backend
or external API is wired up.

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

## Mock data

All content shown in the app — project details, chat transcripts, BOM line items,
logistics scenarios, lead-generation companies, etc. — lives in
[`src/lib/data.ts`](src/lib/data.ts). Components read from this file and from local
React `useState`; nothing is fetched from a network API. Panel open/closed preferences
(Sources, Drafts, Travel Plan) are persisted to `sessionStorage` only, via
[`src/lib/useSessionBoolean.ts`](src/lib/useSessionBoolean.ts).

## Current limitations

- No backend, database, or authentication — everything resets on page reload except
  the `sessionStorage`-backed panel toggles
- No automated unit-test suite (component-level tests), only end-to-end coverage
- Lead Generation, Logistics, and Marketing data is illustrative/mock, not real research
- Costs, scores, and company data are placeholder values for demonstrating the UI

## Next engineering phase

This repository is the frontend/UI layer only. Planned future phases (not started):

- Backend API
- Database (PostgreSQL)
- Vector search / RAG
- Authentication
- External integrations (maps, travel pricing, research data)
- Deployment / cloud infrastructure
