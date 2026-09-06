# WorkEva implementation plan

Date: 2026-09-05. Baseline: the separately delivered PRD v0.3; [implementation scope](FEATURE_SCOPE.md). Repository starts with requirements only.

## Outcome and architecture

Build a runnable Next.js App Router/TypeScript application with Node.js server routes for document review and workflow attestations. The production operational store is Azure SQL; local development uses an explicitly enabled durable file adapter with the same transaction interface. Azure Blob is the production binary store. Local document files are private and served through authorized routes. Databricks supplies read-only supporting/reference data through server-side API calls. The original PDF remains authoritative.

Production fails closed without Entra and SQL/Blob configuration; no production fallback to demo identity or local storage. Development fixtures are synthetic. No user transcript or sensitive real report is committed. Only Azure SQL is implemented initially; Lakebase is a future alternative adapter rather than an unverified dual-write path.

## Work packages and file ownership

1. Root: scaffold, shared types/seed/contracts, API integration, page composition, cross-feature tests, build/browser verification, documentation and Git handoff.
2. Luna high, review domain: `src/server/review.ts`, `tests/review.test.ts`; implement publish/respond/submit/sign/reopen/finalize/export behavior on shared state.
3. Luna high, workflow domain: `src/server/workflow.ts`, `tests/workflow.test.ts`; DAG validation, templates, run creation, calendar math, hard/advisory dependencies, task transitions, impact, reopening and review-gate checks.
4. Luna high, platform: `src/server/store.ts`, `auth.ts`, `files.ts`, `databricks.ts`, `notifications.ts`, `scripts/worker.ts`, `infra/*`, platform tests; implement transactional store, production identity verification, Blob/SQL adapters, local safety and deployment documentation.
5. Luna high, interface: `src/components/*`, `src/app/globals.css`; implement coordinated review and workflow screens against shared API contract and visual design. Root owns route pages and layout.

Shared contracts are committed before parallel implementation. Agents do not alter package manifests or shared types without coordinating with root. No cloud deployment or email is sent during development.

## Milestone 1: foundation and contracts

- Create Next.js app, strict TypeScript, Vitest, Playwright capability, lint/build scripts, stable dependency lock.
- Model principals, report package/version/section/metric/assignment, response revisions, signatures/events, workflow template/run/task/edge, comments/issues, evidence, outbox and audit events.
- Define JSON commands to a single authenticated API handler; exhaustive server-side command validation; read operations return only authorized scope.
- Mutations execute against one transaction callback, require expected revision, append audit/outbox events and commit atomically. Local adapter serializes writes; SQL adapter locks a state row in a serializable transaction as an initial aggregate store. This is a documented initial persistence design, not a claim that the PRD's normalized production schema is complete.
- Seed synthetic BLR and sample graph. Generate a synthetic PDF with explicit sample labeling. Keep uploaded bytes outside `public`.

## Milestone 2: document review

- Publisher uploads PDF with MIME/magic/size/page checks, server hash and scan state. Production requires clean scan verdict; local scan bypass explicitly labeled and rejected in production.
- Configure and validate pages, metric labels, owners and deadline before publication. Version publication creates fresh assignments and supersedes prior current signatures through validity events.
- Save item responses with revision checks and required explanation rules. Separate exception-bearing submission from clean signature. Bind signatures to exact document ID/hash, response revision and statement.
- Retain comment/issue provenance across versions, reset current decisions. Reopen invalidates parent and workflow dependency signatures. Finalize only a fully signed current version with no active exceptions.
- Provide reviewer queue, PDF plus checklist, management coverage/exception views, publication history and downloadable JSON/CSV manifest.

## Milestone 3: workflow tool

- React Flow canvas with task properties, editable nodes/edges, add/remove, drag, auto-layout, saved templates, publish and instantiate actions; keyboard/table alternative.
- Reject self-links, duplicate edges and cycles server-side. Freeze published template snapshots and run baselines.
- Support finish-to-start with nonnegative business-day lag, one calendar per run, all-hard-prerequisite gating, advisory forecast impact, unknown forecast labels.
- Task start/submit/attest/reopen commands enforce assignment, evidence, statement and prerequisite validity. Append historical signatures; invalidation cascades to descendants.
- Bind a document gate to a package/version; derive validity from current required review signatures. New document publication blocks the gate pending explicit rebinding.
- Outbox records targeted downstream delays, re-review and recovery; worker retry/dead-letter behavior is visible.

## Milestone 4: platform and deployment

- Entra token/session verification using trusted issuer/audience and server-managed identity; development principal selection available only with explicit local mode and never in production.
- SQL aggregate transaction migration with revisioned state, app-owned lock, JSON validity; deployment notes call out normalized relational migration as a scaling milestone. Hashes/history are not advertised as external tamper-proof ledger evidence.
- Blob upload/download through authorized server operations, metadata and hash retention, production scan verification gate.
- Databricks allowlisted query parameters, scoped entity check, bounded asynchronous polling, timeout/cancellation and explicit data freshness. Core review must not call Databricks synchronously.
- Node worker reads durable outbox, leases entries, records attempts, retries and provider outcomes. Graph mail requires explicit configuration; dry-run cannot claim sent.
- Azure App Service deployment files and health route, required settings example, operational runbook and named unverified external integration gates.

## Milestone 5: verification and handoff

- Unit/integration: required comments; scope isolation; no blank signing; no stale publication signatures; idempotent retries; multi-owner completion; parent/gate invalidation; cycle/fan-in; cancelled predecessor; immutable baselines; holiday/weekend scheduling; unknown forecast; outbox retries; production fail-closed configuration.
- Run typecheck, tests and production build. Use actual local APIs for representative state changes and uploaded sample PDF, not UI-only success messages.
- Browser: desktop and narrow view; queue → review → comment/save → sign; publish replacement → fresh review; designer → connect → cycle rejection → run → attest → reopen. Inspect screenshots and fix clipping/overflow and console errors.
- Produce a status matrix mapping PRD requirements to implemented/tested/configuration-blocked/deferred. Document limitations precisely, including cloud validation, malware scanning and production operational readiness.
- Commit code and create a draft PR with plan, implementation summary, test evidence and deployment gates. No merge or production deployment in this task.

## Visual system

Professional financial operations workspace: dark navy left navigation, white content surfaces, pale neutral canvas, emerald primary actions, amber exceptions, restrained rounded corners and thin neutral borders. Inter/system sans with 14px UI, 28px page titles, tabular numeric columns. Table-driven dashboard, side-by-side PDF/checklist, broad graph canvas with properties inspector. No marketing hero. Native code text and controls throughout. Generate a coordinated primary-screen concept before frontend implementation; propagate tokens across additional screens.

## Initial execution boundaries

The implementation will be runnable and reviewable locally. Actual Azure subscription, Entra app registration, SQL/Blob endpoints, Databricks warehouse and notification sender are not currently supplied. Build adapters and fail-closed configuration instead of inventing credentials or claiming live deployment. Any remaining PRD capability must be named in the final coverage matrix rather than implicitly represented as shipped.

## Execution record

The plan was executed with GPT-5.6 Luna sub-agents at high effort for domain, platform and interface work. After sub-agent usage limits were reached, root finished integration, the PDF viewer, diagram interactions, task dialogs, publisher/reviewer controls, authorization fixes and verification. See IMPLEMENTATION_STATUS.md for the delivered coverage, actual checks and explicit deviations from the initial plan.

## Workflow source authoring extension

1. Introduce a versioned, strict JSON contract for workflow definitions and safe YAML parsing/serialization. Preserve step IDs, ownership, business-day timing, hard/advisory dependencies, and positions; exclude runtime and publication state.
2. Add file import, editable JSON/YAML source with explicit apply, and downloads to the existing React Flow designer. Imports create new drafts; protect unsaved edits and published templates.
3. Accept the same definition in `saveTemplate`, preserving server authorization, document-reference checks, optimistic concurrency, and existing command compatibility.
4. Verify format round trips, invalid graph rejection, YAML parsing boundaries, permissions, draft persistence, and the source/visual browser journey. Run regression tests and production compilation.
5. Provide equivalent JSON/YAML examples and format documentation, then update the existing draft PR. No deployment or merge.

Implementation delegated to GPT 5.6 Luna at high effort at the user's request; root owns integration review, independent tests, and documentation.
