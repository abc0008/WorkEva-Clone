# Scheduling & Dependency Domain Logic — Research

Dimension: **scheduling** (business-day date math, DAG dependency scheduling, delay propagation, status derivation, alert rules)
Target system: internal finance/accounting workflow + dependency tracker for Pinnacle Financial Partners (Next.js / Node.js / Azure SQL / Azure Web Apps).

---

## 1. What the reference products actually do (and where they stop)

**Workiva Processes.** A "process" is a file type that automates workflows: actions are assigned to a collaborator with an optional *approver* who can accept or return work; each action shows *sent / completed / approved / returned*; processes support **roll forward** ("duplicate your checklist to reuse next quarter"), pre-built **templates**, custom reminder schedules, and a **"Check for issues"** pre-launch validation. Critically, its due-date model already includes business-day relativity: you can "set the due date to the 10th business day", and a **Calendar tab** defines *first and last business days*, *typical working days (Mon–Fri)*, and *exceptions for holidays or special closures*. ([Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes), [Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process))

**Where Workiva stops — and this is the gap Alex is describing.** Workiva's sequencing model is a *start order* setting: "All at once", "One at a time", or "Manual". That is a linear chain or a big-bang launch, **not a dependency graph**. There is no arbitrary predecessor mesh, no critical path, no automatic re-forecast of downstream dates when an upstream task slips. Alex's requirement to "lay out downstream dependencies and trigger alerts to downstream owners when upstream tasks are delayed" is precisely the thing the reference product does not do well.

**Oracle Financial Consolidation and Close (Close Manager)** is the closer analogue for the scheduling engine and worth copying:
- Templates use **work-day nomenclature (WD1, WD2, …)**, and schedules convert the work day to a calendar date — *"Example WD1 = January 2, 2018"*. That is exactly the template→instance roll-forward Alex wants.
- Gantt view where "bars represent duration, and arrows represent dependencies… analyze task interdependencies and identify any bottlenecks."
- **Predecessor links gate status transitions**: *"If you don't want the subsequent tasks to start, remove the predecessor links before force closing the tasks."* A task is not "Open" until predecessors close.
- Four out-of-the-box notification types: **Late Notification, Status Change Notification, Due Date Reminder Notification, Alerts Notification**, with deep links in the email.
- Status vocabulary in use: *open, late, on-time, completed, rejected, at risk (nearly due)*, plus **Error** and an admin **Force Close** escape hatch that unblocks successors.
([Force status](https://docs.oracle.com/en/cloud/saas/financial-consolidation-cloud/usfcc/cm_tasks_force_status.html), [Close Manager best practices](https://reconciliationtransformation.wordpress.com/achieving-financial-close-best-practices-using-oracle-financial-consolidation-and-close-cloud-close-manager/))

**Real close calendars have time-of-day cutoffs, not just dates.** Dartmouth's published GL month-end schedule counts forward from the first business day of the new month, uses the *last business day of the prior month* for pre-close cutoffs, and pins deadlines to clock times — "payables cutoff at 4:00 PM", "WebADI upload cutoff: 10:30 AM", "GL posting deadline: 3:00 PM", "data warehouse update begins at 8:00 PM". ([Dartmouth GL month-end close schedule](https://www.dartmouth.edu/finance/financial-management/accounting/glmonthendcloseschedule.php))

> **R-SCH-1.** A task deadline MUST be modeled as a `(business_day_offset, time_of_day, timezone)` triple resolved to an instant, not as a bare date. Default `time_of_day` SHOULD be configurable per workspace (suggest 17:00) and overridable per task.

---

## 2. Business-day date math

### 2.1 The offset grammar

Two anchors matter for a bank finance department, and both are needed:

| Anchor | Meaning | Example |
|---|---|---|
| `PERIOD_END` | last calendar day of the accounting period | `BD+3` = 3rd business day after period end |
| `PERIOD_END` (negative) | pre-close work | `BD-2` = 2nd business day *before* period end |
| `DUE_DATE` | a regulatory/external deadline anchor | `Call Report due − 5 BD` |
| `PARENT_MILESTONE` | offset from another task's date | for nested sub-schedules |

Convention decision that must be made explicitly and documented, because every finance shop disagrees:

> **R-SCH-2.** Define `BD+1` as **the first business day strictly after the period-end calendar date**. Define `BD+0` as the last business day **on or before** the period-end calendar date (i.e. period end rolled *backward* if it is a weekend/holiday). Define `BD-1` as the business day before `BD+0`. There is no `BD+0` ambiguity gap and no off-by-one at month boundaries. Store the resolved calendar date on the task instance so that a later holiday-calendar edit does not silently move a historical period's dates.

Note Oracle's WD1 = January 2, 2018 (Jan 1 being a holiday, Dec 31 2017 a Sunday) is consistent with this: WD1 is the first *working* day of the new month, i.e. the first business day after period end.

Period-end variants that must be supported:
- **Monthly**: last calendar day of month.
- **Quarterly**: Mar 31 / Jun 30 / Sep 30 / Dec 31 (assume calendar fiscal year for a US bank holding company; make fiscal year start configurable anyway).
- **Year-end**: Dec 31 — and year-end almost always has a *different, longer* template than a normal month. Do not model year-end as "December with extra tasks"; model it as a distinct template variant.
- **Semi-annual / annual regulatory**: ad-hoc anchors.

> **R-SCH-3.** The template MUST allow a `period_type` filter per task (`MONTHLY | QUARTER_END | YEAR_END | AD_HOC`) so one template rolls forward into a month-end instance and a quarter-end instance with the correct task subset, rather than maintaining three drifting templates.

### 2.2 Holiday calendars

Two distinct calendars are in play and conflating them is a real bug source:

1. **Federal Reserve / bank-operating calendar** — governs whether money moves, whether Fedwire is up, and whether counterparties respond. The Fed observes 11 holidays (New Year's Day, MLK Jr. Day, Washington's Birthday, Memorial Day, Juneteenth, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving, Christmas). The weekend rule is asymmetric and must be coded, not assumed: **holiday on Saturday → Reserve Banks are OPEN the preceding Friday; holiday on Sunday → Reserve Banks are CLOSED the following Monday.** ([FRB Services holiday schedules](https://www.frbservices.org/about/holiday-schedules))
2. **The bank's own office/working calendar** — which may add a floating holiday, a company-closure day, or treat a Fed holiday as a working day for the accounting team.

> **R-SCH-4.** Implement a `Calendar` entity (id, name, timezone, working weekdays bitmask, holiday set) with **per-workspace and per-team override**, seeded with the Federal Reserve schedule. Every workflow instance MUST snapshot its `calendar_version_id` at instantiation. Recomputing a closed period's dates against a later calendar edit MUST NOT happen.

> **R-SCH-5.** Holiday data MUST be editable in-app (Workiva's "exceptions for holidays or special closures" model) and MUST be seedable/importable for at least the next 3 years, with an admin warning when the calendar has fewer than 12 months of forward coverage.

The Fed's own published dates for the near horizon (useful as seed data / test fixtures): 2026 — Jan 1, Jan 19, Feb 16, May 25, Jun 19, Jul 4 (Saturday → Reserve Banks open Fri Jul 3), Sep 7, Oct 12, Nov 11, Nov 26, Dec 25. 2027 — Jan 1, Jan 18, Feb 15, May 31, Jun 19 (Saturday), Jul 4 (Sunday → closed Mon Jul 5), Sep 6, Oct 11, Nov 11, Nov 25, Dec 25.

### 2.3 Regulatory anchors worth hard-coding as first-class due dates

Call Report (FFIEC 031/041) is due **30 calendar days after quarter end**; institutions with foreign offices get **35 days for Q1–Q3** but 30 days for year-end; a deadline landing on a weekend moves to the following business day. ([Call Report filing schedule](https://www.bankregreports.com/call-report-filing-schedule/)) Note this is a *calendar-day* offset with a weekend roll — a **different rule** from `BD+N`.

> **R-SCH-6.** Support both offset kinds: `CALENDAR_DAYS_THEN_ROLL_FORWARD` (regulatory) and `BUSINESS_DAYS` (internal close). A single `offset_kind` enum on the task template. Getting this wrong understates a Call Report deadline by up to 4 days.

### 2.4 Libraries and the honest recommendation

**`date-fns` alone is not sufficient.** Its `addBusinessDays` skips only Saturday/Sunday — the implementation literally computes `fullWeeks = trunc(amount/5)`, jumps `fullWeeks*7` calendar days, then steps day-by-day using `isWeekend()`. There is **no holiday awareness**, and `differenceInBusinessDays` has the same limitation. Do not use them for close dates.

Recommended stack:

- **`luxon`** for the timezone/DST-correct instant layer (`DateTime.fromObject({...}, {zone: 'America/New_York'})`), and **`date-fns` v4 + `@date-fns/tz`** if the team prefers the functional style — `date-fns` v4 added `TZDate` and an `{ in: tz(...) }` option so calculations happen in an explicit zone. Either is fine; pick one and ban the other from the codebase.
- **`date-holidays`** (commenthol) for seeding: `init(country, state, region)`, `getHolidays(year)`, `isHoliday(date)`, `setHoliday(...)` for custom rules; holiday `type` of `public | bank | school | optional` — the **`bank`** type is what we want; supports US state subdivisions; code is ISC-licensed but **holiday data is CC BY-SA 3.0**, which needs a legal/attribution check before shipping inside a bank. ([date-holidays](https://github.com/commenthol/date-holidays))
- **`@18f/us-federal-holidays`** is a lighter, US-only, public-domain-friendly alternative worth evaluating specifically to avoid the CC BY-SA question. ([npm](https://www.npmjs.com/package/@18f/us-federal-holidays))
- **Do not depend on `Temporal`** yet in the server hot path. It is in ECMAScript 2026 and Node 22 LTS ships it enabled, with `@js-temporal/polyfill` (~40 KB) available, and `Temporal.PlainDate` is genuinely the right type for date-only arithmetic — but on a bank's Azure Web Apps Node runtime, treat it as a future migration, not a v1 dependency. ([Temporal in ES2026](https://jsmanifest.com/temporal-api-ecmascript-2026))

> **R-SCH-7.** Implement business-day math as a small owned module (`packages/bizdays`) over a **materialized business-day table in Azure SQL**, not as library calls at request time. Persist `dim_business_day(calendar_id, cal_date, is_business_day, bd_index_from_month_start, bd_index_from_month_end, bd_index_from_quarter_end, month_end_date, quarter_end_date)` for ~10 years. Then `BD+3 from 2026-09-30` is a single indexed lookup, `BD-2` is a lookup with a negative index, and the same table is joinable from reporting queries and Databricks. This kills an entire class of loop-based off-by-one bugs and makes the math auditable — which matters for SOX.

---

## 3. The dependency graph

### 3.1 Model

Use a general **DAG**, not a tree and not a linear chain.

```
task_instance(id, workflow_instance_id, template_task_id, owner_id, title,
              offset_kind, offset_n, anchor, due_at, planned_start_at,
              duration_bd, status, ...)

task_dependency(workflow_instance_id, predecessor_id, successor_id,
                dep_type, lag_bd, is_hard,
                PRIMARY KEY (predecessor_id, successor_id))
```

**Dependency types** (standard CPM semantics; MS Project formulas):
- **FS** (finish-to-start): `successor.start = predecessor.finish + lag` — the default and ~95% of close dependencies.
- **SS** (start-to-start): `successor.start = predecessor.start + lag` — parallel prep work.
- **FF** (finish-to-finish): `successor.finish = predecessor.finish + lag` — "recs must be done when the pack is done".
- **SF** (start-to-finish): `successor.finish = predecessor.start + lag` — "the rarest link type by far"; support it in the schema, hide it in the UI.
- **Lag** positive delays the successor; **lead** is negative lag and creates deliberate overlap (`FS-2` = start 2 BD before predecessor finishes). ([MS Project dependency types](https://project2-me.com/ders/task-dependencies-in-ms-project-fs-ss-ff-sf-and-lag-lead-time-explained))

> **R-SCH-8.** `lag` MUST be expressed in **business days** on the task's calendar, and MUST support negative values. Storing lag in hours or calendar days will produce wrong dates across weekends and Fed holidays.

> **R-SCH-9.** Distinguish `is_hard` (a gate: successor cannot be started/affirmed until predecessor is complete) from soft/informational (successor's dates re-forecast, but the owner may proceed). Regulatory sign-off chains are hard; "FYI, the FX rates are loaded" is soft. Without this distinction the tool either blocks people illegitimately or never blocks anyone.

### 3.2 Persisting and querying a DAG in Azure SQL

**Use a plain adjacency table.** Reject SQL Server's `NODE`/`EDGE` graph tables: `SHORTEST_PATH` and `MATCH` exist ([SQL Graph overview](https://learn.microsoft.com/en-us/sql/relational-databases/graphs/sql-graph-overview?view=sql-server-ver17)), but tooling, ORM support, and optimizer behaviour are weak, and for the graph sizes here (tens to low hundreds of nodes per workflow instance) they buy nothing.

**Cycle detection — belt and braces, three layers:**

1. **Application layer (authoritative, on every edge write).** Load the instance's edges (small), and test `willCreateCycle(graph, source, target)` from **`graphology-dag`** — `hasCycle(graph)`, `willCreateCycle(graph, sourceNode, targetNode)`, `topologicalSort(graph): string[]`, `topologicalGenerations(graph): string[][]`, `forEachNodeInTopologicalOrder(graph, cb)`. ([graphology-dag docs](https://graphology.github.io/standard-library/dag.html)) `graphology` is actively maintained; `graphlib` / `@dagrejs/graphlib` is the older Dagre-era fork and I would not take a new dependency on it. For a zero-dependency path, Kahn's algorithm over the edge list is ~30 lines and gives you the topological order you need for CPM anyway.
2. **Database layer (guard against bad writes from any path).** A recursive CTE reachability check in the save transaction, with `OPTION (MAXRECURSION n)` as an explicit blast-radius limit — `MAXRECURSION` raises error 530 and aborts rather than looping forever ([Microsoft docs](https://learn.microsoft.com/en-us/sql/t-sql/queries/recursive-common-table-expression-transact-sql?view=sql-server-ver17)):

```sql
-- reject the edge @pred -> @succ if @pred is already reachable from @succ
WITH reach AS (
  SELECT successor_id AS n, 1 AS depth
  FROM task_dependency WHERE predecessor_id = @succ
  UNION ALL
  SELECT d.successor_id, r.depth + 1
  FROM reach r
  JOIN task_dependency d ON d.predecessor_id = r.n
  WHERE r.depth < 200
)
SELECT TOP 1 1 FROM reach WHERE n = @pred
OPTION (MAXRECURSION 200);
```

3. **Integrity sweep.** A nightly job runs the classic self-ancestor detection (`WHERE AncestorId = DescendantId` with a depth bound — the well-known Swart pattern) across all open instances and raises an admin alert. ([Detecting loops using recursive CTEs](https://michaeljswart.com/2009/09/detecting-loops-using-recursive-ctes/))

> **R-SCH-10.** Cycle rejection MUST be enforced inside the same transaction as the edge insert, and the API MUST return the offending path (`A → B → C → A`) so the UI can highlight it on the react-flow canvas. A generic "invalid dependency" error is useless on a 60-node graph.

> **R-SCH-11.** Cross-workflow dependencies (close → regulatory reporting handoff) MUST be supported, which means the cycle check cannot be scoped to a single `workflow_instance_id`. Model the graph globally per period with an instance-scoped index for the common case.

### 3.3 CPM: forward pass, backward pass, slack

There is no credible maintained npm CPM library — the search space is all project-management blog content, no library. **Write it.** It is ~150 lines over a topological order, and owning it means the business-day calendar is inside the arithmetic rather than bolted on.

Algorithm, with all durations and lags in **business days on the task's calendar** (via the `dim_business_day` index):

```
1. topo = topologicalSort(graph)            // reject if cycle
2. Forward pass, in topo order:
     ES(t) = max over predecessors p of:
        FS: EF(p) + lag ;  SS: ES(p) + lag
        FF: EF(p) + lag - dur(t) ; SF: ES(p) + lag - dur(t)
     ES(t) = max(ES(t), t.earliest_allowed, instance.start)
     EF(t) = ES(t) + dur(t)
3. project_finish = max EF over all sinks
4. Backward pass, in reverse topo order:
     LF(t) = min over successors s of the mirrored constraint,
             bounded above by t.due_bd (the BD+N deadline) if set,
             defaulting to project_finish for sinks
     LS(t) = LF(t) - dur(t)
5. total_float(t) = LS(t) - ES(t)          // in business days
   free_float(t)  = min(ES(s)) - EF(t) over successors s
6. critical  <=> total_float(t) <= 0
```

> **R-SCH-12.** Because close tasks have **hard external deadlines** (`BD+3`, Call Report day 30), the backward pass MUST clamp `LF` to the task's own deadline. This makes `total_float` **negative** when the plan cannot meet the deadline — that negative float *is* the "at risk / will be late" signal, and it is far more useful than a binary comparison of due date to today.

> **R-SCH-13.** Store the computed `ES/EF/LS/LF/total_float/is_critical` on the task instance row (recomputed, not derived at read time) so the Gantt/graph views, the dashboard, and Databricks reporting all agree, and so a historical period retains the numbers it had.

> **R-SCH-14.** Recompute triggers: (a) any task status change, (b) any actual start/finish timestamp write, (c) any edge or duration/offset edit, (d) a scheduled tick at the start of each business day in the workspace timezone, (e) calendar edit on an open instance. Recompute is per **workflow instance subgraph** plus any downstream cross-workflow reachable set — never the whole database.

### 3.4 Delay propagation / re-forecast

This is Alex's headline requirement. The mechanic:

- Every task carries both a **baseline** (`due_at` from the template's `BD+N`, frozen at instantiation) and a **forecast** (`forecast_finish_at`, from the forward pass using actuals).
- When a predecessor's actual finish exceeds its `EF`, the forward pass pushes successors' `ES/EF` out. `slip_bd(t) = forecast_finish_at(t) - due_at(t)` in business days.
- **Absorbed vs. propagated**: if `slip_bd(predecessor) <= free_float(predecessor)`, the slip is absorbed and successors are *not* alerted. Only slip exceeding free float propagates.

> **R-SCH-15.** The system MUST NOT alert downstream owners for a slip fully absorbed by free float. This single rule is the difference between a tool people trust and a tool people mute. It is also why free float must be computed, not just total float.

> **R-SCH-16.** The re-forecast MUST be presented as a diff ("Reg Reporting pack moves BD+5 → BD+7; final review now breaches the Call Report deadline by 2 BD") and MUST name the **root cause task and owner**, not just the local predecessor. Walk the critical path backward from the breach to the earliest task with negative float and cite it.

---

## 4. Status derivation rules

Statuses split into two orthogonal axes; collapsing them into one enum is the most common design mistake here.

**Axis A — lifecycle (owner-driven, explicit state machine):**

`NOT_STARTED → IN_PROGRESS → SUBMITTED → (PENDING_APPROVAL) → COMPLETE`
with `RETURNED` (approver rejected; back to `IN_PROGRESS`), `BLOCKED` (owner-declared or gate-derived), `STOPPED` (deliberate halt by process owner — Alex asked for this), `NOT_APPLICABLE` (skipped this period, with a reason), `FORCE_CLOSED` (admin override that unblocks successors — Oracle's pattern, and it MUST be flagged distinctly for audit).

**Axis B — timeliness (derived, never hand-set):**

Let `now` = current instant in the task's timezone; `D` = `due_at`; `F` = `forecast_finish_at`; `fl` = free float in BD.

| Derived status | Precise rule |
|---|---|
| `COMPLETE_ON_TIME` | lifecycle terminal AND `actual_finish_at <= D` |
| `COMPLETE_LATE` | lifecycle terminal AND `actual_finish_at > D` |
| `BLOCKED` | any hard predecessor not in a terminal lifecycle state |
| `LATE` | not terminal AND `now > D` |
| `AT_RISK` | not terminal AND `now <= D` AND (`F > D` OR `total_float < 0`) — i.e. the plan says it will miss |
| `DUE_SOON` | not terminal AND `now <= D` AND `D - now <= warn_window` (default 1 BD; per-task override) |
| `ON_TRACK` | not terminal AND none of the above |
| `STOPPED` / `NOT_APPLICABLE` | lifecycle-driven, suppresses all timeliness derivation and all alerts |

> **R-SCH-17.** `DELAYED` MUST be defined as a *distinct* concept from `LATE`: **`DELAYED` = not yet past its own due date, but its forecast start has been pushed out by an upstream slip that exceeded free float.** This is the state a downstream owner is in when someone else made them late. It is the state Alex's alert requirement targets. `LATE` is "you missed your date"; `DELAYED` is "someone else moved your date"; `AT_RISK` is "the math says you will miss".

> **R-SCH-18.** `BLOCKED` MUST be derived from hard predecessors, and MUST be visually distinguished from `LATE`. A blocked-and-past-due task is the upstream owner's problem, not the assignee's, and the dashboard MUST attribute it upstream.

> **R-SCH-19.** Timeliness statuses MUST be recomputed on the same triggers as CPM (§3.3 R-SCH-14) and MUST be persisted with a `status_computed_at` so the UI can show staleness and so a nightly audit extract is reproducible.

> **R-SCH-20.** Sign-off/affirmation is a *lifecycle* transition, not a status flag: `SUBMITTED → COMPLETE` requires an attestation record (`user_id`, `attested_at`, `attestation_text_version`, `evidence_ids[]`, `ip`, `entra_object_id`). A task configured to require evidence MUST NOT be completable without at least one linked artifact. Immutable append-only; a reversal is a new `RETURNED` event, never an update.

---

## 5. Timezones

> **R-SCH-21.** Store every instant as `DATETIMEOFFSET` (UTC) in Azure SQL. Store business-day/period dates as `DATE` with no zone. Store a `timezone` (IANA, e.g. `America/New_York`) on the workspace, with optional override per team. Never persist a local wall-clock string.

> **R-SCH-22.** "Due at end of BD+3" MUST resolve as `(BD+3 calendar date) @ (task cutoff time) @ (task timezone) → UTC instant`, computed at instantiation and re-derived only on explicit reschedule. DST transitions MUST be handled by the zone library (luxon/`@date-fns/tz`), never by fixed-offset arithmetic.

Pinnacle is a Southeast regional bank — almost certainly single-timezone (Eastern, with some Central footprint). Design for multi-zone but default everything to one workspace zone; do not make users pick a timezone per task.

---

## 6. Alert / trigger rule design

### 6.1 Event catalogue

| Event | Fires when | Primary recipient | Secondary |
|---|---|---|---|
| `TASK_ASSIGNED` | instantiation or reassignment | assignee | — |
| `TASK_UNBLOCKED` | last hard predecessor completes | assignee | — |
| `DUE_SOON` | crossing `warn_window` (default BD-1 at 09:00 local) | assignee | — |
| `TASK_LATE` | crossing `due_at` | assignee | process owner |
| `TASK_LATE_ESCALATION` | still not terminal at +1 BD, then +2 BD | assignee's manager | close owner |
| `DOWNSTREAM_DELAY` | upstream slip exceeds free float and pushes a successor's forecast | **each affected downstream owner** | process owner |
| `DEADLINE_BREACH_FORECAST` | any task's `total_float < 0`, i.e. the period's external deadline is now at risk | close owner + controller | — |
| `CRITICAL_PATH_CHANGED` | the critical path set changes materially | close owner only | — |
| `AWAITING_APPROVAL` | task submitted | approver | — |
| `RETURNED` | approver rejects | assignee | — |
| `EVIDENCE_MISSING` | terminal attempt without required artifact | assignee (blocking, in-app) | — |
| `WORKFLOW_STOPPED` / `FORCE_CLOSED` | admin action | all downstream owners + audit log | — |

`DOWNSTREAM_DELAY` is the one Alex explicitly asked for and the one that justifies the whole CPM engine.

### 6.2 Noise control

Adopthe standard incident-management primitives, which map cleanly onto close alerts. PagerDuty's guidance is: use a **dedup key** to "automatically deduplicate repeat alerts triggered for the same issue"; **group similar alerts** within or across services under a single incident; and **pause/suppress** non-actionable alerts with defined thresholds. ([PagerDuty: How to reduce noise](https://www.pagerduty.com/ops-guides/ops-practices/reduce-noise/), [Alert fatigue](https://www.pagerduty.com/resources/digital-operations/learn/alert-fatigue/))

> **R-SCH-23.** Every alert MUST carry a **dedup key** of `(event_type, task_instance_id, period_id, materiality_bucket)`. A re-fire with the same key inside the debounce window updates the existing notification instead of creating a new one. `materiality_bucket` = the slip rounded to whole business days, so a slip growing 2 BD → 3 BD *does* re-notify but jitter within a day does not.

> **R-SCH-24.** **Debounce**: hold `DOWNSTREAM_DELAY` for a **15-minute quiet window** after the triggering status change. Close work is bursty — someone reopening and re-closing a task, or an admin fixing three edges in a row, must produce one alert, not five.

> **R-SCH-25.** **Digest by default, immediate by exception.** Batch per-recipient into a single email per run: a 08:30 local morning digest and a 16:00 local afternoon digest during an open period. Send immediately *only* for `DOWNSTREAM_DELAY`, `DEADLINE_BREACH_FORECAST`, `RETURNED`, and `TASK_LATE_ESCALATION`. One person receiving eleven separate "task X is due" emails on BD+2 is how this tool gets abandoned.

> **R-SCH-26.** **Escalation ladder**, time measured in business days on the task's calendar: `due_at` → assignee. `+1 BD` → assignee + their manager. `+2 BD` → + close/process owner. `+3 BD` → + controller. Escalation MUST stop on any lifecycle transition out of the stuck state, and MUST be suppressed entirely for `BLOCKED` tasks (escalate the *blocker's* owner instead — R-SCH-18).

> **R-SCH-27.** **Quiet hours.** No alerts outside 07:00–19:00 local, none on non-business days for that calendar, unless the event is `DEADLINE_BREACH_FORECAST` on a regulatory deadline within 2 BD. Queue and release at the next window open.

> **R-SCH-28.** Every alert MUST be persisted (`notification` table: dedup_key, recipient, channel, event, payload, sent_at, suppressed_reason) — both for the "did anyone tell me?" argument that always happens during close, and as SOX evidence that the control notification fired.

> **R-SCH-29.** Channels: email (Microsoft Graph / Azure Communication Services) + in-app + **Microsoft Teams** via an incoming webhook or bot. Given Entra ID auth and a Microsoft-shop bank, Teams is where these people actually live; email-only will underperform.

### 6.3 Where the evaluation runs

> **R-SCH-30.** Run status/CPM re-evaluation as (a) synchronous recompute of the affected subgraph inside the mutating request, and (b) an **Azure Functions timer trigger** sweep every 15 minutes for time-based transitions (`DUE_SOON`, `TASK_LATE`, escalation ticks) plus a start-of-business-day full sweep of open periods. Prefer this over Azure SQL **Elastic Jobs** ([overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/elastic-jobs-overview?view=azuresql)) so the business-day and CPM logic lives in one place — the Node codebase — rather than being duplicated in T-SQL. ([Microsoft: background jobs guidance](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs))

> **R-SCH-31.** The sweep MUST be idempotent and safe to run concurrently: guard with a per-instance optimistic-concurrency `rowversion`, and make alert emission conditional on the dedup-key insert succeeding (unique index) so a double-run cannot double-notify.

---

## 7. Roll-forward (template → period instance)

> **R-SCH-32.** A `WorkflowTemplate` holds tasks with **relative** offsets (`BD+N`), dependency edges, owner *roles* (not user ids), duration in BD, evidence requirements, and `period_type` applicability. Instantiating for a period resolves: period end → calendar dates via `dim_business_day`; roles → users via a role-assignment map (with an explicit unresolved-role blocker); and snapshots `template_version_id` + `calendar_version_id`.

> **R-SCH-33.** Instantiation MUST run a **pre-flight validation** (Workiva's "Check for issues"): cycle-free, every task has a resolvable owner, no due date already in the past, no orphan hard-blocked task, calendar covers the full span. Report all findings at once; do not fail on the first.

> **R-SCH-34.** Template edits MUST be versioned and MUST NOT retroactively alter open or closed instances. Offer an explicit "apply template v(n) changes to the open October instance" action with a diff preview.

---

## 8. Concrete build order for this dimension

1. `dim_business_day` + `Calendar` + Fed holiday seed. Test fixtures around Jul 4 2026 (Sat) and Jul 4 2027 (Sun), and month-ends falling on weekends.
2. Offset resolver (`BD+N`, `BD-N`, `CALENDAR_DAYS_THEN_ROLL_FORWARD`) with the R-SCH-2 convention pinned in tests.
3. Adjacency table + 3-layer cycle detection + topological sort.
4. CPM forward/backward pass with deadline-clamped `LF` and negative float.
5. Status derivation (both axes) with persisted `status_computed_at`.
6. Delay propagation + free-float absorption rule.
7. Alert engine: dedup key, debounce, digest, escalation ladder, notification log.
8. Roll-forward + pre-flight validation.

---

## Sources

- [Workiva — Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Workiva — Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [Workiva — How to build a financial close process flowchart](https://www.workiva.com/blog/how-build-financial-close-process-flowchart)
- [Federal Reserve Bank Services — Holiday Schedules](https://www.frbservices.org/about/holiday-schedules)
- [Call Report Filing Schedule and Deadlines](https://www.bankregreports.com/call-report-filing-schedule/)
- [Dartmouth — GL Month End Close Schedule](https://www.dartmouth.edu/finance/financial-management/accounting/glmonthendcloseschedule.php)
- [Oracle FCCS — Forcing task status](https://docs.oracle.com/en/cloud/saas/financial-consolidation-cloud/usfcc/cm_tasks_force_status.html)
- [Achieving Financial Close Best Practices using Oracle FCCS Close Manager](https://reconciliationtransformation.wordpress.com/achieving-financial-close-best-practices-using-oracle-financial-consolidation-and-close-cloud-close-manager/)
- [date-fns — addBusinessDays / differenceInBusinessDays source](https://github.com/date-fns/date-fns) (via Context7: weekend-only, no holiday support)
- [date-fns — time zones guide (`TZDate`, `tz()`)](https://github.com/date-fns/date-fns/blob/main/pkgs/core/docs/timeZones.md)
- [date-holidays (commenthol)](https://github.com/commenthol/date-holidays)
- [@18f/us-federal-holidays](https://www.npmjs.com/package/@18f/us-federal-holidays)
- [graphology-dag — hasCycle / willCreateCycle / topologicalSort](https://graphology.github.io/standard-library/dag.html)
- [MS Project — FS, SS, FF, SF and lag/lead explained](https://project2-me.com/ders/task-dependencies-in-ms-project-fs-ss-ff-sf-and-lag-lead-time-explained)
- [Microsoft — Recursive CTEs (MAXRECURSION)](https://learn.microsoft.com/en-us/sql/t-sql/queries/recursive-common-table-expression-transact-sql?view=sql-server-ver17)
- [Michael J. Swart — Detecting loops using recursive CTEs](https://michaeljswart.com/2009/09/detecting-loops-using-recursive-ctes/)
- [Microsoft — SQL Graph overview](https://learn.microsoft.com/en-us/sql/relational-databases/graphs/sql-graph-overview?view=sql-server-ver17)
- [Microsoft — Elastic Jobs overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/elastic-jobs-overview?view=azuresql)
- [Microsoft — Best practices for background jobs](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs)
- [PagerDuty — How to reduce noise](https://www.pagerduty.com/ops-guides/ops-practices/reduce-noise/)
- [PagerDuty — Understanding alert fatigue](https://www.pagerduty.com/resources/digital-operations/learn/alert-fatigue/)
- [Temporal API in ECMAScript 2026](https://jsmanifest.com/temporal-api-ecmascript-2026)
