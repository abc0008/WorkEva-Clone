# WorkEva

Financial document review and dependency-based workflow attestations. Next.js, React, TypeScript and Node.js, designed for Azure App Service with Azure SQL and Blob Storage. Databricks integration is read-only supporting data.

## Run locally

Requires Node.js 22 or 24 and npm.

```bash
npm ci
cp .env.example .env.local
# Ensure WORKEVA_LOCAL_MODE=true in .env.local for the synthetic local workspace.
npm run dev
```

Open [localhost:3000](http://localhost:3000). The application seeds a two-page **synthetic** BLR, two assigned reviewers and a month-end workflow template. No real bank document or meeting transcript is included. Use the development user selector to switch between Avery (Alabama reviewer), Jordan (Tennessee reviewer), Taylor (publisher/process owner) and Casey (application administrator).

Local records persist under `.data/`; uploaded PDFs are private and served through authorized routes. Local mode is prohibited when `NODE_ENV=production`. `next start` therefore requires production Azure/Entra configuration; use `next dev` to exercise the synthetic environment.

## Core journeys

1. As Avery, open My reviews, inspect the PDF and answer the five required metrics. An explanation or N/A answer requires a comment. Save then explicitly sign.
2. As Taylor, inspect the management dashboard. Upload a PDF in Documents, configure sections/pages/metrics/owners, then publish. New versions require fresh sign-offs and retain historical context.
3. In Workflow designer, edit the template and dependencies, publish it and create a period run. In Workflow runs/My tasks, complete and attest prerequisites. Hard edges block dependent work. Reopening signed work invalidates dependent attestations.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:api
npx playwright install chromium
npm run test:browser
```

Unit and integration tests exercise real server domain rules, access boundaries, immutable review history, version invalidation, dependency cycles and business-day dates. Cloud integration tests require actual provisioned infrastructure; a successful local test is not evidence that Entra, Azure SQL, Defender scanning, Graph mail or Databricks have been validated in your tenant.

## Project map

- `docs/IMPLEMENTATION_PLAN.md`: implementation sequence, ownership and verification gates.
- `docs/FEATURE_SCOPE.md`: two-feature implementation scope.
- `docs/API_CONTRACT.md`: shared command/API contracts.
- `src/server/review.ts`: versioned review rules and signing.
- `src/server/workflow.ts`: graph, schedule, task and attestation rules.
- `src/server/store.ts`: transactional local/Azure SQL persistence.
- `src/server/auth.ts`, `files.ts`, `databricks.ts`, `notifications.ts`: integration boundaries.
- `src/components`: responsive product interface.
- `infra/runbook.md`: Azure configuration and deployment gates.

The initial SQL adapter stores a revisioned aggregate in one transactionally locked row. It favors a reviewable implementation of cross-feature atomicity; it is not the PRD's final normalized schema. Normalize and benchmark before broad enterprise rollout. Lakebase is an alternative future adapter, not implemented alongside SQL in this branch. Operational state never writes back into source financial facts.

See `docs/IMPLEMENTATION_STATUS.md` for verified behavior and remaining limitations. The original root requirements/research remain historical background; `docs/FEATURE_SCOPE.md` defines the current scope.
