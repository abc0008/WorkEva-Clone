# Implementation status

Verified 6 September 2026. This branch delivers a runnable first implementation of both requested features. The production target is Next.js/Node on Azure Web Apps with Azure SQL operational writeback, private Azure Blob documents, and a server-side Databricks reference-data API. Cloud services have not been deployed or validated in a tenant.

## Coverage

| Capability | Implemented behavior | Verification / boundary |
| --- | --- | --- |
| Document review | Authorized source PDF canvas, pagination, zoom, original download, assigned section queue, required metric responses and comments | Browser renders actual PDF bytes and persists review/sign-off; synthetic sample only |
| Crowdsourced assignments | Multiple reviewers per section, page/metric mapping, required metrics, parent section dependencies | Domain validates active reviewer and entity scopes; publisher mapping editor provided |
| Versioned sign-off | Explicit statement, actor/time/hash/revision snapshot, optimistic concurrency, idempotency, append-only signature invalidation | Domain and real HTTP tests; original idempotent result survives subsequent reopening |
| Review lifecycle | Draft, exception-bearing submission, clean signature, reopening, parent invalidation and final designation | Tests reject blank/exception/stale/unassigned signing; manager can reopen with a reason |
| Replacement PDFs | Original files retained, fresh response assignments, carried comment provenance, invalidation of prior signatures and workflow descendants | Real API journey uploads v2, publishes, checks reset and invalidation |
| Management view | Current-version response/sign-off coverage, exceptions, overdue assignments and filters | Browser page and server-scoped snapshots; response percentages use required metrics |
| Final export | Downloadable JSON manifest with document metadata, responses/history, signatures and validity events, original PDF URL | Real API journey verifies current version; exports are audited |
| Diagram designer | Draggable nodes, connect/delete edges, hard/advisory links and lag, property editor, arrange, duplicate, save and publish | React Flow; domain rejects cycles, duplicates and self-links; browser publishes a template |
| Workflow source authoring | Versioned JSON/YAML file import, explicit source apply, current-graph downloads, draft creation and unsaved-change guards | Format and server tests; browser imports YAML, drags/edits nodes, exports JSON, reimports and saves a source-edited name while preserving the published template |
| Workflow runs | Published template snapshots, unique task IDs, period selection, pinned calendar/baseline dates | Domain tests verify run isolation and business-day cutoff dates |
| Task execution | Start, submit, explicit attestation, independent approval, evidence, forecast, reopen and document-gate rebinding | Browser completes a task; real HTTP journey completes the dependency chain |
| Dependency enforcement | Every hard predecessor must have a valid completion; business-day lag enforced; invalidation cascades | Fan-in, weekend lag, version replacement and reopen tests; blocked state calculated on server |
| Impact preview | Direct/indirect dependents, affected owners, each task's baseline/current forecast, unknown forecast and risk | API and domain tests; readable UI instead of raw JSON |
| Evidence | Private PDF validation, source hash, local storage or Azure Blob, pending/clean/rejected scan states | Local round trip tested; production verdict requires Defender tag verification |
| Identity and authorization | Explicit local personas; Entra JWT verification or explicitly trusted EasyAuth; active provisioned accounts and entity checks | Local/access tests; live Entra login and managed identity require tenant setup |
| Writeback | Atomic local file transactions or serializable Azure SQL aggregate transactions | Local tested; Azure SQL adapter implemented but not integration-tested against a provisioned database |
| Notifications | Durable outbox, claims/lease ownership, timeouts, bounded retries, due/late/reopen/unblocked events, Graph adapter and dry run | Dry run verified; no email was sent; live delivery requires a configured worker/mailbox |
| Databricks | Approved parameterized entity reference query, managed identity/token option, asynchronous polling and deadlines | Adapter implemented; no warehouse credentials supplied and no live result claimed |
| Azure packaging | Web and worker Docker targets, Bicep skeleton, environment example, bootstrap script and runbook | Next production build passes; Docker/Bicep and tenant networking must be validated on deployment runner |

## Test evidence

- `npm run build`: production compilation, TypeScript and route generation pass.
- `npm test`: 56 tests across review, workflow, portable definitions, cross-feature contracts, access, HTTP origin and platform boundaries.
- `npm run test:api`: actual Next HTTP server journeys cover unauthorized/cross-entity mutations, repeat sign requests, both assigned reviewers, finalization, graph-cycle rejection, run completion, document gate signing, replacement PDF publication, dependent signature invalidation and current-version export.
- `npm run test:browser`: Chromium at 1536 × 1024 and 390 × 844; renders the source PDF, saves five responses, records and verifies a signature, switches persona, opens Documents, publishes a workflow template, creates a run, starts/submits/attests a task and checks mobile overflow. No page errors or horizontal overflow in the verified run.
- CI repeats the build, tests and representative HTTP/browser journeys. CI has been added; its remote execution has not been observed in this session.

Browser evidence uses an isolated synthetic state/files directory. The script writes screenshots and `result.json` beneath `.data/qa/`. Local Chromium was supplied through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; on another runner install Playwright Chromium using the README command.

The source-authoring browser journey also checks invalid YAML, canceled discard of unapplied source, node-position round trips, and a 390px designer layout. Connected Browser navigation to localhost returned `ERR_BLOCKED_BY_CLIENT`, so verification used local Playwright Chromium. JSON/YAML examples and the portable API contract are documented in [WORKFLOW_FORMAT.md](WORKFLOW_FORMAT.md). The format contains no runtime signatures or completion history.

## Visual review

The implemented screen was compared directly with the generated review concept at the same desktop width. The five checks were: navy sidebar width and hierarchy, white workspace and emerald actions, side-by-side source/checklist proportions, aligned response controls, and visible attestation footer. Early checks found default button borders, a blank PDF viewer, misaligned response columns and mobile task-action overflow; these were corrected.

Intentional differences: role-scoped navigation; an explicit synthetic-demo badge; a real two-page sample rather than the concept's illustrative 51-page document; inline review guidance and provenance; a visible full signature statement; source PDF content rendered from bytes rather than recreated HTML. The workflow diagram supports pan/zoom and the inspector scrolls independently on desktop. The narrow view wraps actions and stacks panels.

## Remaining product and rollout work

1. Provision and validate Azure/Entra/SQL/Blob/Defender/Databricks/Graph using `infra/runbook.md`. Production deliberately has no local identity or file-store fallback. The browser relies on EasyAuth ingress for interactive sign-in; no standalone MSAL login flow is included.
2. Normalize the single-row SQL aggregate and benchmark expected concurrency/data volume before enterprise rollout. Retention, external immutable audit storage, backup recovery objectives and tenant isolation require an approved production design. Application history/hashes are not an external tamper-proof ledger.
3. Lakebase is not implemented: Azure SQL is the selected option. Databricks integration currently retrieves approved entity reference data; arbitrary query builders, financial fact writeback and automatic PDF regeneration are outside this implementation.
4. Separate issue ownership/resolution tracking, a printable final review packet, CSV exports, Excel ingestion, bulk user/group synchronization and notification preference administration remain follow-on work. Current concerns use versioned responses and comment history; the administration page is read-only and user provisioning uses the operator script.
5. Calendars can be supplied through the API; there is no holiday/calendar administration screen, Gantt view or drag-to-reschedule timeline. Baseline dates remain immutable. Notification links open the correct screen but do not yet preselect every referenced assignment/task.
6. Assigned reviewers may read the complete original PDF; page mapping is navigation, not page-level data redaction. Cross-entity workflow runs currently require scope to all run entities to appear in the snapshot. Agree these access policies before importing restricted reports.
7. The PDF canvas has page navigation/zoom and original download, but no OCR, full-text search, annotation layer or accessible PDF text layer. Complete keyboard/screen-reader auditing, browser-matrix testing, load testing, abuse/rate-limit controls and an independent security review remain production gates.

No live deployment, production data upload, real financial-document import or notification delivery was performed.
