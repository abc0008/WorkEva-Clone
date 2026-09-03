# Architecture Research — Finance Workflow & Dependency Tracker (Azure)

Research dimension: **architecture**. Target: internal Workiva-Processes-like workflow/dependency tracker for Pinnacle Financial Partners finance & accounting (month-end close, regulatory reporting, cross-team handoffs).

---

## 1. Executive recommendation (the short version)

Build a **single Next.js (App Router) application** deployed as a **Linux Azure App Service** (Premium v3), backed by **Azure SQL Database** accessed through **Prisma** (or Drizzle — see §4), with **Azure Blob Storage** for evidence, **Entra ID** auth via **Auth.js v5 + the Microsoft Entra ID provider**, a **separate Azure Functions (Node, Flex Consumption) app** for timer-driven schedule recalculation and queue-driven alert dispatch via **Azure Service Bus**, notifications through **Microsoft Graph `sendMail`** plus a **Power Automate Workflows webhook** for Teams, real-time collaboration via **Azure Web PubSub** carrying **Yjs** updates, and **App Insights via `@azure/monitor-opentelemetry`** for observability. Analytics/Power BI is served by **Lakeflow Connect CDC replication of Azure SQL into Delta** — *not* by making Databricks Lakebase the primary OLTP store.

The single most important architectural decision: **Azure SQL is the system of record; Databricks is downstream.** Lakebase is genuinely attractive but it solves a problem you do not have (serving lakehouse data to apps at low latency, AI agent state), and it introduces a Databricks-workspace dependency into the availability path of a control that auditors will care about.

---

## 2. Compute topology: one Next.js app or Next.js + separate API?

**Recommendation: Next.js route handlers + server actions for the interactive app; a *separate* Azure Functions app for background work. Do not stand up a Fastify/NestJS service in phase 1.**

Rationale:

- The workload is CRUD-heavy with a rich client (react-flow canvas). Next.js App Router route handlers under `app/api/**` plus server actions cover it, and colocating removes an entire deployment, an entire auth-propagation problem (you would otherwise need on-behalf-of token exchange or a shared JWT), and a CORS surface.
- The genuine argument for a separate Node service is **long-running / scheduled work** — schedule recalculation across every open run, alert fan-out, Graph mail sending, blob virus-scan callbacks. That work does not belong in a request handler on a web tier that Azure will recycle. Put it in **Azure Functions** (timer trigger + Service Bus trigger), which is the Microsoft-recommended pattern for scheduled and queue-driven background jobs ([Well-Architected: background jobs](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/background-jobs), [timer trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-timer)).
- **Avoid App Service WebJobs.** They are co-tenant with the web app (they consume the same instance CPU/memory, and `AlwaysOn` quirks), have weaker observability, and are effectively legacy for new Node work. Azure Container Apps Jobs is a reasonable alternative if the org already standardizes on containers ([ACA Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)).
- **Do not use a `node-cron` in the web app.** With more than one App Service instance you get N duplicate alert emails per tick. If you absolutely must (phase 0 spike), guard with a DB-based leader lock row.

**Hosting note:** Next.js on App Service Linux works but is not the golden path Microsoft markets — you want `output: 'standalone'`, an explicit startup command (`node server.js`), `WEBSITE_RUN_FROM_PACKAGE=1`, and Node 20/22 LTS. Practical write-ups: [Azure OSS Dev Blog: NextJS on App Service Linux](https://azureossd.github.io/2022/10/18/NextJS-deployment-on-App-Service-Linux/) and a current [Next.js 16 + pnpm on App Service Linux guide](https://www.modern42.com/blog/deploy-next-js-16-pnpm-linux-azure-web-app). **Azure Static Web Apps is the wrong choice here** — its Next.js hybrid support has historically lagged App Router features and it is a poor fit for a private, VNet-integrated internal app ([SWA Next.js docs](https://learn.microsoft.com/en-us/azure/static-web-apps/nextjs)). If the "Mosaic AI hub" is already container-centric, **Azure Container Apps** is a clean substitute for App Service with the same application architecture — scale-to-zero, KEDA, and jobs in one place ([App Service vs Container Apps 2026](https://nicheelab.com/en/articles/azure/app-service-vs-container-apps/)).

**Requirement statements**
- The application SHALL be deployed as a Linux Azure App Service (Premium v3, minimum 2 instances) with VNet integration and Private Endpoints to SQL and Storage.
- Background scheduling and alerting SHALL run in a separate Azure Functions app; no scheduled work SHALL execute inside the web tier.
- All Azure-to-Azure authentication SHALL use a user-assigned managed identity; no connection-string secrets in App Settings except where a service does not support MI.

---

## 3. Data store: Azure SQL vs Databricks Lakebase

**Azure SQL Database is the OLTP system of record.** Reasons specific to this project:

1. **Temporal tables.** Azure SQL's system-versioned temporal tables give you a *free, tamper-evident, query-able* row history on every table — exactly what an audit-relevant close tracker needs, with `FOR SYSTEM_TIME AS OF` reconstruction of "what did the workflow look like at close-of-BD3?" ([Temporal tables in Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/temporal-tables?view=azuresql), [usage scenarios](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-table-usage-scenarios?view=sql-server-ver17)). This is a strong, concrete reason to pick SQL Server over Postgres for *this* app. Note: you still want an explicit application-level `audit_event` table for intent ("who signed off, from what IP, on what evidence hash") — temporal tables capture *state*, not *intent*.
2. **Bank-standard operational posture.** Private endpoints, Entra-only authentication, TDE, Azure SQL Auditing to a Log Analytics workspace, Failover Groups, and a security/DBA team that already knows how to run it.
3. **Entra ID / managed identity** is first-class ([Managed identity for Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-azure-ad-user-assigned-managed-identity?view=azuresql)).

**Where Databricks Lakebase fits.** Lakebase (managed serverless Postgres, **GA on Azure March 3, 2026**) offers Postgres 17-class compute with autoscaling and scale-to-zero, instant branching/zero-copy clones, PITR, pgvector, Unity Catalog governance, Entra ID integration, and **synced tables in both directions** — Unity Catalog → Postgres for serving, and a Postgres change feed → Delta for analytics ([GA announcement](https://www.databricks.com/blog/azure-databricks-lakebase-generally-available), [Lakebase Postgres docs](https://learn.microsoft.com/en-us/azure/databricks/oltp/projects/)).

Lakebase becomes the *right* answer when one of these is true:
- The tracker needs to **read lakehouse data at low latency inside the transaction path** — e.g., a task cannot be marked complete until a reconciliation metric computed in Databricks is green, and you want that metric as a local table join, not an API call.
- You want **AI agent memory / RAG over close documentation** in the same store (pgvector).
- The org mandates that all new data assets be Unity-Catalog-governed.
- You want **branch-per-environment** dev/test with production-shaped data (this is a real developer-productivity win).

Lakebase's weaknesses for this specific app: scale-to-zero cold starts are hostile to an interactive app used sporadically during the day; there is no temporal-table equivalent (you'd hand-roll history tables or rely on the Delta change feed, which is asynchronous and therefore not an audit control); and it couples app availability to the Databricks workspace.

**Verdict: Azure SQL primary, Databricks downstream. Revisit Lakebase in phase 3** if lakehouse-derived data needs to participate in dependency conditions.

**Analytics sync path (recommended):** use **Lakeflow Connect's managed SQL Server connector** to CDC Azure SQL into Delta on a schedule, then serve Power BI from Databricks SQL ([managed database connectors / CDC overview](https://learn.microsoft.com/en-us/azure/databricks/ingestion/lakeflow-connect/cdc-overview), [SQL Server source setup](https://learn.microsoft.com/en-us/azure/databricks/ingestion/lakeflow-connect/sql-server-source-setup), [near-real-time CDC to Delta walkthrough](https://techcommunity.microsoft.com/blog/azure-databricks/near%E2%80%93real-time-cdc-to-delta-lake-for-bi-and-ml-with-lakeflow-on-azure-databricks/4502750)). This requires enabling **CDC or Change Tracking** on the Azure SQL database ([enable built-in CDC](https://learn.microsoft.com/en-us/azure/databricks/ingestion/lakeflow-connect/sql-server-cdc)) — do this from day one, because retrofitting CDC onto a live audit database is a change-control event. Cheaper fallback for MVP: Power BI DirectQuery / Import against a set of read-only reporting views in Azure SQL.

---

## 4. ORM: Prisma vs Drizzle on Azure SQL

This is closer than the general-purpose comparisons suggest, because **SQL Server is a second-class citizen in both**.

**Prisma**
- Mature `sqlserver` provider (SQL Server 2017+), with the `@prisma/adapter-mssql` driver adapter wrapping `node-mssql` ([Prisma SQL Server docs](https://www.prisma.io/docs/orm/overview/databases/sql-server)).
- **Documented limitations that matter here:** *`Json` type is not supported on SQL Server* — significant, since the react-flow canvas payload and template parameters are natural JSON columns. Workaround: store as `NVARCHAR(MAX)` and validate with Zod at the boundary (which you want anyway), optionally with a SQL `CHECK (ISJSON(col) = 1)` constraint.
- Also: only one NULL per UNIQUE constraint; circular FK references need `NoAction`; raw string params default to `NVARCHAR(4000)`/`NVARCHAR(MAX)` and will **defeat indexes on `VARCHAR` columns** unless cast — declare text columns as `NVARCHAR` consistently to avoid this trap.
- **Managed identity:** historically the biggest gap ([prisma#13853](https://github.com/prisma/prisma/issues/13853), [prisma#7673](https://github.com/prisma/prisma/issues/7673)). The driver-adapter route is what unblocks it: `node-mssql`/`tedious` supports `azure-active-directory-default` and `azure-active-directory-msi-app-service` authentication types, so you construct the pool yourself with MI and hand it to `PrismaMssql`. **Validate this in a spike before committing** — it is the single highest-risk technical assumption in this document.
- Prisma Migrate on SQL Server cannot use `sp_bindefault` and some ALTERs require table recreation — combined with temporal tables (which block certain DDL), expect to hand-write some migrations.

**Drizzle**
- MSSQL dialect **exists but is release-candidate**, installed via `drizzle-orm@rc` / `drizzle-kit@rc`, built on `node-mssql` ([Drizzle MSSQL get-started](https://orm.drizzle.team/docs/get-started-mssql), [v1 roadmap](https://orm.drizzle.team/roadmap), [feature issue #585](https://github.com/drizzle-team/drizzle-orm/issues/585)).
- Because Drizzle hands you the `mssql` Pool directly, **managed identity is trivially supported** — you own the pool config. This is a real advantage.
- SQL-first, no query engine binary, better for the hand-tuned recursive CTEs you will need for dependency traversal.
- Risk: RC status on a regulated bank's system of record; migration tooling on MSSQL is less battle-tested.

**Recommendation:** **Prisma for MVP** (team velocity, mature migrations, better ecosystem for Auth.js adapters), with **all dependency-graph traversal and schedule recalculation written as raw parameterized SQL / stored procedures**, not ORM queries. Reassess Drizzle at the point Drizzle MSSQL hits stable v1. Whichever you pick, **write the graph algorithms in SQL** (recursive CTE for transitive downstream closure, plus a topological-order column maintained on write) — this is the part where ORM abstraction actively hurts.

*Contingency:* if the MI spike fails on Prisma and the bank forbids SQL-auth passwords, switch to Drizzle rather than fighting Prisma, or keep Prisma but source a short-lived AAD access token from `DefaultAzureCredential` and refresh it into the adapter.

---

## 5. Evidence storage — Blob

- One storage account, container per environment, blob path `runs/{runId}/tasks/{taskId}/{evidenceId}/{originalFilename}`. Never trust the client filename for the path; store it as metadata.
- **Upload:** browser → short-lived **user delegation SAS** (write-only, 15 min, single blob, IP-restricted if feasible), minted by a server route that has already authorized the user against the task. User delegation SAS is signed with an Entra key rather than the account key, so **the account keys can be disabled entirely** ([create a user delegation SAS with JavaScript](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-create-user-delegation-sas-javascript), [REST reference](https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas)). The App Service managed identity needs **Storage Blob Data Contributor** *and* **Storage Blob Delegator**.
- **Download:** identical pattern, read-only SAS, and log every mint into `audit_event` — "who downloaded which piece of evidence" is an audit question you will be asked.
- **Immutability:** enable a **time-based immutability policy / legal hold** on the evidence container, and **versioning + soft delete**. Evidence supporting a sign-off must not be replaceable after affirmation. Store a **SHA-256 of the uploaded bytes** on the `evidence` row at ingest and re-verify on download — this is the cheap control that makes the whole thing defensible.
- **Network:** private endpoint on the storage account, public network access disabled. Note this means the *browser* cannot reach blob storage directly on the corporate network unless private DNS resolves for clients — if it does not, proxy uploads through the app (chunked) instead of SAS. **Confirm this with the network team before designing the upload UX.**
- Antivirus scanning (Defender for Storage) with a quarantine state on the evidence row until clean.

---

## 6. Auth: Auth.js vs MSAL

**Recommendation: Auth.js (NextAuth) v5 with the `microsoft-entra-id` provider** ([Auth.js Entra provider docs](https://authjs.dev/getting-started/providers/microsoft-entra-id)).

- The app's own needs are: sign in with the corporate account, get `oid`/`upn`/`groups`, establish a session. Auth.js does this in ~40 lines and integrates natively with App Router middleware and server components.
- Use **app roles or security groups** in the Entra app registration for RBAC (`Admin`, `ProcessOwner`, `Preparer`, `Reviewer`, `Viewer`, `Auditor`), surfaced in the ID token and mapped to a local `app_user`/`role_assignment` table on first login. Prefer app roles over raw group GUIDs — group claims overflow past ~200 groups and force a Graph call.
- **MSAL Node is required only where you need tokens *for Graph*** — sending mail, resolving user photos/managers. Do that with **client credentials (app-only)** in the Functions app, not on-behalf-of from the web tier. So: Auth.js for user sign-in, MSAL (or `@azure/identity` + `ClientSecretCredential`/MI) for service-to-Graph. This split is cleaner than forcing Auth.js to broker Graph tokens.
- Conditional Access / MFA is enforced by Entra, not the app. **Sign-off actions SHOULD additionally require a re-authentication or step-up** — implement as an `acr`/`auth_time` freshness check (re-prompt if the session is older than N minutes at the moment of attestation). This is the technical analogue of an e-signature control.

---

## 7. Background jobs, scheduling, and alerts

**Two Function apps' worth of work, one Function app:**

| Function | Trigger | Job |
|---|---|---|
| `recalcSchedules` | Timer, every 15 min + on-demand via queue | Recompute `planned_start`/`planned_due` from BD offsets, cascade slack through the dependency graph, set `is_late`/`at_risk` |
| `evaluateAlerts` | Timer, hourly during business hours | Detect newly-late/at-risk tasks; enqueue notification messages; dedupe against `alert` table |
| `dispatchNotification` | Service Bus queue | Send Graph mail / Teams card; write delivery result |
| `rollForward` | Queue (user-initiated) | Instantiate a template into a new period run |
| `syncHolidays` | Timer, monthly | Refresh holiday calendar |

**Queue: Azure Service Bus, not Storage Queue.** The decisive features are **duplicate detection** (you must not double-alert a controller), **sessions/FIFO** (per-run ordering), **scheduled messages** (send the reminder at 8am the next business day), **dead-lettering**, and **topics** for fan-out to email + Teams + in-app ([Storage queues vs Service Bus queues](https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-azure-and-service-bus-queues-compared-contrasted), [duplicate detection](https://learn.microsoft.com/en-us/azure/service-bus-messaging/enable-duplicate-detection)). Standard tier is sufficient; Premium if private endpoints are mandated.

**Business-day engine — the core domain logic.** Model it as data, not code:
- `holiday_calendar` (e.g., `US-FRB`, `US-BANK`, `PNFP-CORP`) and `holiday_date` rows. Feed from the Federal Reserve Bank holiday schedule for regulatory-reporting calendars.
- A materialized **`business_day` table**: one row per (`calendar_id`, `date`) with `is_business_day`, and a dense `bd_ordinal` **within the period**, plus a signed `bd_from_period_end`. With this table, "BD+3" is a single indexed lookup and "BD-2 from month end" is equally cheap — no date arithmetic at query time, no timezone bugs, and it is trivially auditable because a human can look at the table.
- Store offsets as `(anchor, offset, calendar_id)` where `anchor ∈ {PERIOD_START, PERIOD_END, PREDECESSOR_COMPLETE, FIXED_DATE}`. Workiva itself models due dates this way — its actions accept calendar dates or **business-day references such as "5th business day"**, with configurable working hours, exceptions, and holiday-aware calendars ([Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)).
- Time-of-day matters: "BD+3" for a controller means "by 5pm Central on BD3". Store `due_time` and a `timezone` on the calendar; compute in UTC, render local.

**Status model.** Keep two orthogonal axes rather than one enum:
- `execution_status`: `NOT_STARTED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED/REJECTED → COMPLETE`, plus `BLOCKED`, `SKIPPED`, `STOPPED`.
- `timeliness`: derived, `ON_TRACK | AT_RISK | LATE | COMPLETED_LATE`. Derived means recomputed by the engine, never set by a user. `AT_RISK` should be *predictive* — a task is at risk if its earliest feasible start, given upstream actuals, exceeds its planned start.

**Downstream alerting** is the differentiating feature. When task T slips, the engine walks the transitive downstream closure (recursive CTE), recomputes projected dates, and notifies each downstream **owner** with the *specific* impact ("Regulatory Reporting FR Y-9C tie-out now projects BD+7, was BD+5, because GL Close is 2 days late"). Suppress duplicates with Service Bus duplicate detection keyed on `(taskId, alertType, projectedDueDate)` and an `alert` table with a cooldown window.

---

## 8. Notifications: Graph vs SMTP vs Teams

- **Email: Microsoft Graph `sendMail` with an application permission (`Mail.Send`), scoped by an application access policy** to a single shared mailbox (e.g., `close-tracker@pnfp.com`). Do *not* grant tenant-wide `Mail.Send` — restrict it ([permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference), [restricting Mail.Send with app access policies](https://blog.mindcore.dk/2026/02/microsoft-graph-remembered-to-restict-mail-send-application-permission-app-access-policies/)). Graph beats SMTP relay here: no credentials, MI-friendly, deliverability inside the tenant, and the sent items land in a mailbox you can audit.
- **Teams: do NOT build on Office 365 connectors / incoming webhooks.** They are being progressively disabled with rollout **May 18–22, 2026**; Microsoft's recommended replacement is **Power Automate Workflows** ([retirement announcement](https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/)). For MVP, post an Adaptive Card to a channel via a **Workflows (Power Automate) HTTP-request-triggered flow** — one flow, one URL, no app registration. For phase 3, a **notification-only Teams bot** gives proactive 1:1 messages and actionable cards ("Affirm" / "Request extension" buttons) ([notification bot guidance](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-notification-capability)).
- **SMTP relay is the fallback only** if Graph app permissions cannot be approved by the Entra admins in time. Design the notification dispatcher behind an `INotificationChannel` interface so this is a config swap.

---

## 9. Real-time collaboration

Two different problems; do not solve them with one mechanism.

**(a) Multiple inputters on the same run's task list.** This is coarse-grained: statuses, comments, assignments. **Server-Sent Events (SSE) from a Next.js route handler is sufficient and is the MVP answer** — one-way, works through corporate proxies, no extra Azure resource, no sticky-session requirement. Complement with optimistic concurrency (`rowversion` / `ETag`) so two people editing the same task get a conflict rather than a silent overwrite. Add per-field presence indicators ("Dana is editing").

**Caveat:** SSE on App Service with multiple instances means each instance only knows about its own mutations. Solve by publishing mutations to a **Service Bus topic** that every instance subscribes to and rebroadcasts, or move straight to (b).

**(b) Concurrent editing of the react-flow template canvas.** This genuinely needs CRDT. React Flow's own guidance: sync the **durable** state (node/edge ids, types, data, positions, dimensions, source/target) and treat cursors, viewport and selection as **ephemeral**; the recommended approaches are **Yjs** (their official collaborative example), Automerge/Loro, or Liveblocks (which ships a React Flow SDK) ([React Flow Multiplayer](https://reactflow.dev/learn/advanced-use/multiplayer)).

Transport: **Azure Web PubSub**, not SignalR Service. Web PubSub is the language-agnostic raw-WebSocket / pub-sub service and explicitly targets non-.NET backends and custom subprotocols; SignalR Service is the right choice only for ASP.NET backends ([Web PubSub FAQ](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/resource-faq)). A Yjs `y-websocket`-style provider over Web PubSub is a clean fit. Persist the Yjs document state as a binary snapshot column alongside a **normalized, queryable** representation of the graph — never let the CRDT blob be the only representation, because the scheduling engine must query the graph in SQL.

Pragmatic phasing: **MVP = last-writer-wins on the canvas with a soft edit lock + SSE for the run views.** CRDT canvas is phase 2. Many finance teams edit templates rarely and concurrently almost never; the concurrency requirement is really about the *run*, not the *template*.

---

## 10. Observability

- **`@azure/monitor-opentelemetry`** in both the Next.js server and the Functions app — it is the current supported path and supersedes the classic `applicationinsights` SDK ([Enable OpenTelemetry in App Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable), [npm package](https://www.npmjs.com/package/@azure/monitor-opentelemetry)). Initialize in `instrumentation.ts` (Next.js `register()` hook), node runtime only.
- **Custom metrics that matter:** tasks late by process, alert dispatch latency, schedule-recalc duration, sign-offs per period, evidence upload failures. Wire an Azure Monitor alert on "schedule recalculation has not succeeded in 60 minutes" — a silently dead scheduler is the failure mode that destroys trust in the tool.
- **Correlate** `runId`/`taskId` as span attributes so a controller's "why did I get this alert" question is one KQL query.
- Azure SQL Auditing → Log Analytics; Storage diagnostic logs → same workspace.

---

## 11. Proposed data model

Core tables (SQL Server; `Id UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID()` PKs; every business table **system-versioned temporal** unless noted).

**Templates**
- `process_template` — `id, name, description, category, owner_group_id, status(DRAFT|PUBLISHED|ARCHIVED), current_version_id, created_by, created_at`
- `process_template_version` — `id, template_id, version_no, published_at, published_by, canvas_layout NVARCHAR(MAX) (react-flow viewport/positions), notes`. **Versions are immutable once published**; runs bind to a version, so editing a template never mutates history.
- `task_template` — `id, template_version_id, key (stable human code e.g. GL-CLOSE-01), name, description, group_id, sort_order, owner_role_id, default_assignee_user_id, requires_approval BIT, approver_role_id, requires_evidence BIT, evidence_types, estimated_duration_minutes, anchor(PERIOD_START|PERIOD_END|PREDECESSOR|FIXED), bd_offset INT, calendar_id, due_time TIME, criticality, node_x, node_y`
- `task_template_group` — `id, template_version_id, name, start_order(ALL_AT_ONCE|SEQUENTIAL|MANUAL), sort_order` (mirrors Workiva's groups/start-order concept)
- `dependency_template` — `id, template_version_id, predecessor_task_template_id, successor_task_template_id, dep_type(FS|SS|FF|SF), lag_business_days INT, is_hard BIT` — `is_hard` distinguishes "cannot start" from "advisory, alert only"

**Runs (instances)**
- `period` — `id, calendar_id, period_type(MONTH|QUARTER|YEAR), period_start, period_end, label ('2026-08')`
- `process_run` — `id, template_version_id, period_id, name, status(OPEN|CLOSED|CANCELLED), opened_at, opened_by, closed_at, target_completion_date`
- `task` — `id, run_id, task_template_id, key, name, assignee_user_id, owner_group_id, execution_status, timeliness, planned_start, planned_due (DATETIME2), projected_due, actual_start, actual_complete, completed_by, blocked_reason, criticality, sort_order, notes, row_version ROWVERSION`
- `task_assignment` — `id, task_id, user_id, role(PREPARER|REVIEWER|WATCHER), assigned_at, assigned_by` (many inputters per task)
- `dependency` — `id, run_id, predecessor_task_id, successor_task_id, dep_type, lag_business_days, is_hard, is_satisfied BIT`
- `task_comment` — `id, task_id, user_id, body, parent_id, created_at, mentions`

**Sign-off & evidence**
- `signoff` — `id, task_id, signoff_type(PREPARE|REVIEW|APPROVE|ATTEST), user_id, decision(AFFIRMED|REJECTED), attestation_text (the exact wording shown), signed_at, auth_time, acr, ip_address, user_agent, evidence_manifest_hash` — store the attestation *statement text* on the row, not a FK, so a wording change cannot retroactively alter what someone attested to.
- `evidence` — `id, task_id, uploaded_by, original_filename, content_type, size_bytes, blob_container, blob_path, blob_version_id, sha256, scan_status(PENDING|CLEAN|QUARANTINED), uploaded_at, superseded_by_id`

**Scheduling & alerting**
- `holiday_calendar` — `id, code, name, timezone, workweek_mask`
- `holiday` — `calendar_id, date, name, source`
- `business_day` — `calendar_id, date, is_business_day, bd_ordinal_in_month, bd_from_month_end` (materialized, refreshed monthly)
- `alert` — `id, run_id, task_id, alert_type(DUE_SOON|LATE|UPSTREAM_DELAY|BLOCKED|REJECTED), severity, triggered_at, upstream_task_id, projected_impact_days, dedupe_key, status(PENDING|SENT|SUPPRESSED|FAILED)`
- `notification` — `id, alert_id, recipient_user_id, channel(EMAIL|TEAMS|IN_APP), sent_at, provider_message_id, delivery_status, error`
- `notification_preference` — `user_id, channel, alert_type, enabled, digest_frequency`

**Identity & audit**
- `app_user` — `id, entra_object_id, upn, display_name, email, department, manager_user_id, is_active`
- `role_assignment` — `user_id, role, scope_type(GLOBAL|TEMPLATE|RUN), scope_id`
- `audit_event` — `id, occurred_at, actor_user_id, action, entity_type, entity_id, run_id, before_json, after_json, ip_address, correlation_id` — append-only, no updates/deletes, separate from temporal history.

**Key indexes:** `task(run_id, execution_status)`, `task(assignee_user_id, timeliness)`, `dependency(run_id, predecessor_task_id)` and `(run_id, successor_task_id)` for both-direction traversal, `alert(dedupe_key)` unique filtered on `status <> 'SUPPRESSED'`, `business_day(calendar_id, date)` clustered.

**Cycle prevention:** enforce DAG-ness at write time with a recursive-CTE check inside the insert transaction; a cycle in a close calendar is a silent disaster.

---

## 12. Phasing

**MVP (target ~10–12 weeks)**
Template CRUD with react-flow canvas (single-editor, save layout + normalized graph); publish/version templates; roll-forward instantiation into a period run; task list + Kanban + Gantt-lite views; BD offset engine with holiday calendars; assignment to multiple users; simple sign-off (single-step affirm) with evidence upload to Blob via user-delegation SAS; email alerts for due-soon/late via Graph + Service Bus + Functions timer; Entra sign-in with roles; SSE live refresh; App Insights; audit log and temporal tables from day one.

**Phase 2**
Preparer/reviewer/approver multi-step sign-off with rejection loops; downstream-impact alerting with projected-date cascade; Teams Adaptive Cards via Power Automate Workflows; CRDT (Yjs + Web PubSub) collaborative canvas; conditional dependencies; SLA/cycle-time dashboards; digest notifications; delegation/out-of-office reassignment.

**Phase 3**
Lakeflow CDC → Delta → Power BI executive dashboards; Teams notification bot with actionable cards; template library with cross-entity reuse; SOX control mapping and evidence packaging for auditors; possible Lakebase adoption for lakehouse-conditioned tasks; API for upstream systems (GL, reg-reporting tools) to auto-complete tasks.

---

## 13. Risks

1. **Prisma + Azure SQL + managed identity** — unproven combination; spike in week 1. Fallback: Drizzle, or AAD token injection.
2. **Prisma has no `Json` type on SQL Server** — plan `NVARCHAR(MAX)` + Zod from the start.
3. **Private endpoints vs browser-direct SAS uploads** — may force a proxy-upload design; confirm with networking early.
4. **Graph `Mail.Send` app permission approval** is an org process, not a technical task; start it week 1. Keep an SMTP fallback.
5. **Teams connector retirement (May 2026)** already happened — any inherited internal guidance referencing incoming webhooks is stale.
6. **Next.js on App Service** is a supported-but-not-showcased path; budget time for the standalone build + startup-command dance, or go Container Apps.
7. **Schedule engine correctness** is the product. Invest disproportionately in a golden-dataset test suite over the business-day table (leap years, holidays on weekends, fiscal vs calendar month-end, DST boundaries).
