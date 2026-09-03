# Dashboards, Reporting and Notification UX
Research dimension for the Pinnacle finance workflow + dependency tracker. Scope: the *view inventory*, the *metric definitions*, the *in-app vs Power BI split*, and the *notification/inbox UX*. Deliberately excludes alert trigger rules and delivery plumbing (covered elsewhere).

---

## 1. View inventory

Comparable products converge on a small number of view archetypes. Oracle Close Manager ships exactly four views over one task set — BI Dashboard (default), Calendar, Task List, Gantt — plus a per-user "My Worklist" portlet ([Oracle docs](https://docs.oracle.com/cd/E64585_01/FCLAD/cm_navigating_views.htm)). Workiva Processes offers a Process tab (overview panel + progress charts + configurable action list) and a Calendar tab, with three CSV exports: Process Actions, Process Status, Process Activity ([Monitor a process](https://support.workiva.com/hc/en-us/articles/360061603252-Monitor-a-process), [View and export process reports](https://support.workiva.com/hc/en-us/articles/4406116571668-View-and-export-process-reports)). Numeric centres on "a centralized dashboard to track close pacing across the team" with drill-down into individual task progress and workload by entity/department, plus dependency-based bottleneck identification ([Numeric](https://www.numeric.io/solutions/close-management-software)).

The lesson: **one task table, many saved lenses.** Build a single server-side query/filter/column engine and express most "dashboards" as saved views over it. Only the canvas, the critical-path view and the executive rollup need bespoke rendering.

### V1 — My Tasks (personal queue)
- **Audience:** every inputter/preparer/reviewer. This is the app's home page and the destination of every notification deep link.
- **Questions:** What do I owe today? What's overdue? What's about to unblock/block me? What's waiting on my sign-off?
- **Fields:** Task name · Process/period (e.g. "Month-End Close — Aug-2026") · Entity · My role (Preparer/Reviewer/Approver) · Due BD label + resolved calendar date + time · Status (Not started / In progress / Submitted / In review / Signed off / Blocked / N/A-waived) · Days late (business days, signed) · Blocked-by (upstream task + its owner + its projected finish) · Blocking (count downstream) · Evidence attached (Y/N + count) · Last comment/mention · Quick actions: Start, Complete, Attach evidence, Sign off, Reassign, Add note.
- **Grouping:** Overdue → Due today → Due this BD range → Waiting on me for review → Blocked (not my fault) → Upcoming. "Blocked" must be visually distinct from "late" — a person whose upstream slipped should not see red they can't act on.

### V1 — Close Status Board (controller during close week)
- **Audience:** controller, close manager, accounting managers.
- **Questions:** Are we on track for BD+X? Which BD bucket is behind? Who is underwater? What is the single thing to escalate right now?
- **Layout:** BD column board (BD1…BD10 columns, tasks as cards) or a matrix of team × BD with completion cells. Header KPI strip: % complete, tasks due today / done today, count late, count at-risk, count blocked, count awaiting sign-off, projected close date vs target.
- **Fields per card:** task, owner, team, status, due BD, evidence flag, review state, age since due.
- **Filters:** entity, team, process, owner, tag (e.g. "SOX key control", "regulatory"), risk rating.
- Must support "bulk nudge" from a selection and one-click drill to the task.

### V1 — Dependency / Critical-Path View
- **Audience:** close manager, process owner, anyone diagnosing a slip.
- **Questions:** What's on the critical path? If Treasury's FX load lands at BD+4 instead of BD+2, who moves and by how much? What is the longest chain still open?
- **Rendering:** two modes over the same graph — (a) the react-flow canvas, decorated with live status colouring and a highlighted critical path; (b) a Gantt/timeline with BD gridlines, holiday shading and dependency arrows. Gantt is the one auditors and controllers read; the canvas is the one owners design in.
- **Fields:** earliest/latest start, slack/float (business days), projected finish (forward pass from actuals), baseline finish, variance, path id, is-critical flag, blocked-since timestamp.
- **Key interaction:** "impact preview" — select a task, set a hypothetical finish, see the downstream set that would shift and by how many BDs, and who owns each. This is the same computation that powers the downstream-delay alert, so build it once as a service and reuse it.

### V1.5 — Sign-off / Attestation Completeness
- **Audience:** controller, SOX/internal-controls, external audit.
- **Questions:** Which required attestations are outstanding? Who has not signed? Is every signed item backed by an unmodified evidence set?
- **Fields:** task · required sign-off roles (preparer/reviewer/approver, N-of-M) · each signer's name, title, UTC timestamp, method, IP/device, auth assurance · attestation statement text and version at time of signing · evidence hash bound to the signature · re-open events after sign-off (count + reason).
- SOX-grade audit trails are expected to answer who signed, what they signed (document hash/fingerprint), when (system-controlled timestamp), and how the record was protected from later alteration — auditors reject editable PDFs and bare email approvals without system logs ([ZiaSign](https://ziasign.com/blogs/sox-compliance-electronic-records-2026)). Design the sign-off record to be immutable and exportable as a period package.

### V1.5 — Evidence Completeness
- **Audience:** preparers, reviewers, audit liaison.
- **Fields:** task · evidence required (policy flag) · files attached (name, type, size, uploader, upload time, hash) · file matches expected type (PDF/XLSX) · attached before or after sign-off · link to source (Blob URI) · staleness (uploaded date vs period end).
- **Metric:** *evidence completeness %* = tasks with all required evidence ÷ tasks requiring evidence. Simple, unambiguous, and a real audit-readiness signal.

### V2 — Bottleneck / Aging View
- **Audience:** close manager, process improvement.
- **Questions:** Where does work sit? Which handoffs are slow? Which tasks block the most others?
- **Fields:** open items aged 0-1 / 2-3 / 4-5 / 6+ BDs past due · time-in-status histogram (submitted→reviewed, reviewed→approved) · blocked-time (calendar and business hours a task spent waiting on an upstream) · downstream-fanout (count of transitively blocked tasks) · owner/team.
- The unito SLA article's core insight applies directly: measure **both active work time and handoff/transfer time**, because the delay usually lives in the gap between teams, not inside a team's work ([Unito](https://unito.io/blog/sla-aware-ticket-escalation-workflows/)). Instrument `assigned→started` and `submitted→review-claimed` separately from `started→submitted`.

### V2 — Executive / Portfolio View
- **Audience:** CFO, chief accounting officer, department heads; also the regulatory-reporting owner across FR Y-9C / Call Report / FFIEC cycles.
- **Questions:** How did this close compare to the last six? Which entities/teams are chronically late? Are we trending toward a shorter close? Any period with a control exception?
- **Fields/metrics:** days-to-close per period (trend), on-time % per period, % late by team, tasks completed by BD curve overlaid across periods ("burnup by BD"), reopen rate, first-pass sign-off rate, count of escalations, evidence completeness %.
- Cross-period and cross-entity — this is the natural Power BI surface (see §2).

---

## 2. Metric definitions (and which are vanity)

Precise definitions matter more than the metric list; ambiguity here is what makes close KPIs get gamed.

| Metric | Definition | Notes |
|---|---|---|
| **Days to close** | Business days from period end (BD0) to the timestamp of the final gating task (e.g. "financials issued"), not to the last task of any kind. | APQC: median 6.4 calendar days, top quartile 4.8, bottom quartile 10, across ~2,300 orgs, defined as trial balance → consolidated financial statements ([Numeric summary](https://www.numeric.io/blog/how-long-does-month-end-close-take), [CFO.com](https://www.cfo.com/news/metric-of-the-month-cycle-time-for-monthly-close/659297/)). Pick one gating task per process and never change it silently — version it. |
| **On-time %** | Tasks completed on or before due datetime ÷ tasks due, per period. Completion = the terminal state the task type defines (signed off, not merely "submitted"). | Exclude waived/N-A tasks from denominator; report the waiver count alongside or it becomes gameable. |
| **Tasks completed by BD** (burnup) | Cumulative completed count at each BD, vs plan curve. | The single most useful in-close chart; shows whether you're front-loaded or crashing at BD+5. |
| **% late by team** | Late tasks ÷ tasks due, grouped by owning team. | Always show alongside *blocked-late* (late because upstream slipped) vs *self-late*. Publishing raw team late% without that split is unfair and destroys trust in the tool. |
| **Average cycle time per task type** | Median (not mean) of `started → completed` in business hours, bucketed by task template id. | Use median + p90. Mean is skewed by one abandoned task. |
| **Reopen rate** | Tasks reopened after sign-off ÷ tasks signed off, per period. | Strong quality signal; also a control-risk signal for SOX. |
| **First-pass sign-off rate** | Tasks approved on first review submission ÷ tasks submitted for review. | Trintech's "Journal Entry Quality" analogue (rejected vs total) ([Trintech](https://www.trintech.com/blog/16-kpis-to-prioritize/)). |
| **Aging of open items** | Distribution of business days past due for still-open tasks, as of now. | Operational, not trend. Belongs in-app. |
| **Tasks at risk** | Open tasks whose *projected* finish (forward pass over the dependency graph using actuals + template durations) exceeds their due datetime, but which are not yet late. | The most valuable derived metric and the input to proactive alerts. Requires the impact-preview engine from §1. |
| **Critical-path on-time** | Was each critical-path task completed on schedule? | Trintech calls this "On-Time Critical Path" — better leading indicator than overall on-time% ([Trintech](https://www.trintech.com/blog/16-kpis-to-prioritize/)). |
| **Handoff latency** | `submitted → review claimed` and `upstream complete → downstream started`, median business hours. | The bottleneck metric that most tools miss. |
| **Evidence completeness %** | Defined in §1.5. | |

**Vanity / trap metrics — do not put on the executive view:**
- *Raw task count completed* (rewards splitting tasks).
- *Overall % complete* without a plan curve (always looks fine at BD+8).
- *Number of comments / logins / "engagement"* — has no finance meaning.
- *Average days late* across all tasks — one abandoned task dominates; use count-late and p90.
- *On-time % computed after due-date edits.* Freeze a baseline due date at period instantiation; measure against baseline and show current due separately. Without this, on-time% trends to 100% and means nothing.

---

## 3. In-app dashboards vs Power BI

The operational/analytical split is standard and the separation is treated as non-negotiable because analytical queries contend with the transactional workload ([Streamkap](https://streamkap.com/resources-and-guides/operational-reporting-vs-analytical-reporting), [Xenia](https://www.xenia.team/articles/operational-dashboards-vs-analytics-dashboards)).

**In the app (Azure SQL, live, clickable-through):** My Tasks, Close Status Board, dependency/critical-path/Gantt, aging, sign-off completeness, evidence completeness, per-period exports (mirroring Workiva's Actions/Status/Activity CSVs). Rule of thumb: *if the answer changes a decision within the next four hours, or the user needs to click from the number into the task, it belongs in the app.* Latency target: current-period views read live (seconds), no scheduled refresh.

**In Power BI / Databricks (Lakebase via Lakeflow CDC):** cross-period trends, entity benchmarking, days-to-close history, cycle-time distributions by task type, team performance over 12+ periods, close-cost analysis, and anything joined to non-tracker data (headcount, ERP close data, regulatory calendars). Latency target: refreshed nightly; CDC gives near-real-time if wanted, but nobody should be making close-week decisions in Power BI.

**Practical split given the stack:**
1. Azure SQL is the operational system of record. Model an explicit **event/audit table** (`task_event`: task_id, event_type, actor, from_status, to_status, ts_utc, payload) — it is both the audit trail and the source for every cycle-time metric. Do not try to reconstruct cycle time from current-state columns.
2. Lakeflow CDC replicates `task`, `task_event`, `process_instance`, `signoff`, `evidence` into Lakebase/Delta. Build a nightly **snapshot fact** (`fact_task_daily`) so "tasks at BD3 as of that period" is queryable retroactively — current-state-only replication cannot answer historical questions.
3. Compute metric definitions **once**, in dbt/SQL in the lake, and have the app read a small set of pre-aggregated period-level KPIs (or recompute the same SQL against Azure SQL for the current period). Two independent implementations of "on-time %" is the classic failure — the controller and the CFO get different numbers.
4. Embed Power BI in an app tab (Analytics) with Entra ID pass-through and RLS by entity/team, so users don't leave the tool. Keep it clearly labelled as "as of last night".

---

## 4. Notification and inbox UX

### 4.1 Four distinct object types
Do not lump these together; they need different urgency, different UI, and different preference switches.

| Type | Definition | Default channel | Batchable |
|---|---|---|---|
| **Task assignment** | You are now the owner/reviewer of a task. Directed, expected, actionable. | In-app + Teams card | Yes (roll-up at instantiation: "12 tasks assigned to you for Aug-2026 close") |
| **Alert** | A state change that threatens a date: due-soon, now late, upstream slipped, blocked, escalation. | Teams card, email on escalation | Due-soon: yes. Late/downstream-impact: no. |
| **Mention** | A human addressed you in a comment. | In-app + Teams, immediate | No |
| **Digest** | Scheduled summary of your open items and your team's risk. | Email (Teams optional) | It *is* the batch |

Critical alerts must bypass batching: "security alerts or urgent messages should not wait for the next batch or digest" ([SuprSend](https://docs.suprsend.com/docs/best-practices-for-batching-digest)).

### 4.2 In-app inbox
A persistent notification centre with: unread badge, tabs (All / Mentions / Alerts / Assignments), each item showing icon-by-type, one-line subject, entity/period, timestamp, and inline actions (Complete, Attach, Sign off, Snooze, Mark read). Every notification, on every channel, links to the same task deep link. The inbox is the durable record; email/Teams are transports.

### 4.3 Preference model (per user, overridable per process)
```
user_notification_pref(
  user_id, event_type, channel {inapp,teams,email},
  mode {immediate, digest, off},
  digest_schedule {daily@HH:MM, twice_daily, weekly},
  quiet_hours_start/end, timezone,
  close_week_override boolean,   -- suppress quiet hours BD1..BD5
  min_severity {info, warn, critical}
)
```
Granular controls of exactly this shape are reported to cut unsubscribes by up to ~30% without reducing send volume ([Courier](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)). Ship sane defaults (mentions immediate, due-soon digest, late immediate, escalation email+Teams) — most users never open the settings page.

**Batching rules:** group by *grouping key* (process instance + event type), cap digest items to top N by risk with "and 14 more", most important first, and throttle to a max sends-per-hour per user with overflow rolled into the next digest ([SuprSend](https://docs.suprsend.com/docs/best-practices-for-batching-digest), [Courier](https://www.courier.com/blog/how-to-reduce-notification-fatigue-7-proven-product-strategies-for-saas)). Suppress duplicates across channels — a Teams card acted on within 10 minutes should cancel the queued email.

### 4.4 Does anyone read email?
Internal email benchmarks are better than consumer intuition suggests: 76% average internal open rate, 9% click rate, 21% CTOR across 255k+ campaigns; banking 79% open / 8% click / 9% CTOR; financial services 81% / 9% / 10%; 84% desktop, 88% sent through Office 365; org size 10,000+ opens at 73% ([ContactMonkey 2026](https://www.contactmonkey.com/blog/internal-email-benchmark-report-2026)). Read those honestly: **~4 in 5 open, fewer than 1 in 10 click.** For a close tool that means email is fine for a digest and for escalation-to-manager, and poor as the primary call-to-action channel. Put the action in Teams (adaptive card, in the flow of work, actionable inline) and use email as the redundant/escalation channel. Track click-through per event type in-product and prune any alert type whose CTR stays under ~5% for two consecutive periods — measurement of open/click/opt-out is the recommended feedback loop ([SuprSend](https://docs.suprsend.com/docs/best-practices-for-batching-digest)).

### 4.5 Anatomy of a downstream-delay alert
Send to the *downstream owner*, cc-visible to the upstream owner (never a blind escalation).

- **Subject/title:** `Your task "FX Revaluation JE" is now projected BD+5 (was BD+3)`
- **Because:** `Treasury — FX Rate Load slipped: due BD+2, now projected BD+4 (owner: J. Ruiz, last update 2h ago)`
- **Impact:** new projected start/finish, business days of slip, whether it breaches your due date, and how many tasks downstream of *you* move.
- **Confidence:** state that projection uses template duration; show the assumption.
- **CTA (one primary):** "Open task" — plus secondaries "Acknowledge & re-plan", "Message upstream owner", "Flag at risk to close manager". Acknowledgement should be one click, because "claiming should be effortless (single clicks rather than form-filling)" ([Unito](https://unito.io/blog/sla-aware-ticket-escalation-workflows/)).
- **Footer:** period, entity, link to critical-path view filtered to this chain; "why am I getting this / adjust notifications".

Anti-patterns: alerting the downstream owner repeatedly for the same slip (send once, then only on material change ≥1 BD or on resolution); alerting people whose slack absorbs the slip; alerting the whole team.

### 4.6 Actionable notifications and the audit trail
Teams adaptive cards / Outlook actionable messages let a user complete or approve without opening the app ([Stoneridge](https://stoneridgesoftware.com/adaptive-cards-in-teams-and-outlook-keep-your-business-processes-moving-quickly/), [m365.fm](https://www.m365.fm/your-teams-notifications-are-dumb-fix-them-with-adaptive-cards/)). Guardrails:
- **Allowed from a card:** acknowledge, mark complete, add a comment, request extension, reassign-to-me.
- **Not allowed from a card:** attestation/sign-off, and any action requiring evidence. Sign-off needs authenticated identity (not just an email link), a hash-bound document version, a system-controlled timestamp and tamper-evident storage ([ZiaSign](https://ziasign.com/blogs/sox-compliance-electronic-records-2026), [BoldSign](https://boldsign.com/blogs/electronic-signature-audit-trail-guide/)). Cards should deep-link into the app for those, where the user re-authenticates via Entra (step-up/MFA) and sees the attestation text before confirming.
- Every card action writes a `task_event` with `channel='teams_card'`, the Entra object id resolved from the verified token (never the display name in the payload), the card's correlation id, and the card version. Card payloads are replayable — enforce idempotency keys and expire action tokens (e.g. 7 days).

---

## 5. Escalation policy design

Escalation must read as *help arriving*, not *a report to your boss*. Design principles:

1. **Escalate the task, not the person.** Language: "This item needs help to stay on plan" and "Close manager notified so BD+5 doesn't slip", never "X is late".
2. **Owner-first ladder.** Nobody is escalated over until they've had a chance: (T0) due-soon nudge to owner, in-app + Teams; (T1) at due, owner alert with one-click "I need more time / I'm blocked"; (T2) +1 BD, owner + backup/delegate + notify downstream owners; (T3) +2 BD *or* immediately if the task is on the critical path, close manager gets it on the exceptions list (a queue, not an email blast); (T4) +3 BD or projected slip to the close date, line manager + controller, email + Teams, with the impact quantified.
3. **Critical path compresses the ladder.** A critical-path or regulatory-deadline task escalates at T2 in hours, not days. Non-critical tasks with slack should barely escalate at all.
4. **Acknowledgement stops the clock (once).** An owner who acknowledges with a new committed date pauses escalation until that date; a second miss escalates immediately. This is the "acknowledge within a defined window or it moves up the chain" pattern ([Unito](https://unito.io/blog/sla-aware-ticket-escalation-workflows/)).
5. **Blocked ≠ late.** If the task is blocked by an upstream, escalation routes to the *upstream* owner's ladder, and the downstream owner is informed, not chased. Getting this wrong is the fastest way to make the tool hated.
6. **Manager sees a digest, not a firehose.** Managers get one daily close-week digest ("3 items at risk on your team, 1 escalated") plus immediate notice only for T4.
7. **Escalations are logged and reportable** (count per period, per team, time-to-resolution — Trintech's "Issue Time to Resolution" analogue), and reviewed in the post-close retrospective as a process-improvement input, explicitly not as a performance metric. Say so in the tool's copy.

---

## 6. Numbered requirements

**Views**
1. The system SHALL provide a personal "My Tasks" queue grouped into Overdue / Due today / Due this period / Awaiting my review / Blocked / Upcoming, with inline Start, Complete, Attach evidence and Sign-off actions.
2. The system SHALL visually and semantically distinguish "late (own)" from "blocked by upstream" in every view and metric.
3. The system SHALL provide a close status board pivoting tasks by business day and by team, with a KPI header (% complete, due today, late, at-risk, blocked, awaiting sign-off, projected close date vs target).
4. The system SHALL provide a dependency view in two synchronised renderings — the react-flow canvas with live status colouring, and a Gantt/timeline with BD gridlines, holiday shading and dependency arrows — with the critical path highlighted.
5. The system SHALL provide an "impact preview" that, for a hypothetical or actual finish date, returns the transitive set of affected downstream tasks, their BD shift and their owners; this service SHALL be the sole source for both the view and downstream-delay alerts.
6. The system SHALL provide a sign-off completeness view exposing, per required attestation, the signer identity, UTC timestamp, attestation text version, authentication method and the hash of the bound evidence set.
7. The system SHALL provide an evidence completeness view and metric over tasks flagged as requiring evidence.
8. The system SHALL provide an aging/bottleneck view including business-days-past-due buckets, time-in-status distributions, handoff latency and downstream fan-out.
9. The system SHALL provide period-level exports equivalent to Workiva's Actions, Status and Activity reports (CSV and XLSX).
10. All views SHALL be filterable by entity, process, period, team, owner, tag and risk rating, and users SHALL be able to save and share named views.

**Metrics**
11. The system SHALL freeze a baseline due date per task at period instantiation and compute on-time metrics against the baseline, displaying the current due date separately.
12. The system SHALL define completion as the task type's terminal state (sign-off where required) and SHALL exclude waived tasks from on-time denominators while reporting waiver counts.
13. The system SHALL persist an immutable `task_event` log and derive all cycle-time, handoff-latency and aging metrics from it rather than from current state.
14. The system SHALL compute "tasks at risk" from a forward pass over the dependency graph using actual completions plus template durations, in business days honouring the holiday calendar.
15. Each metric SHALL have exactly one implementation shared by the app and the BI layer; a data dictionary page SHALL expose each definition to end users.

**BI split**
16. Operational, current-period views SHALL read live from Azure SQL; cross-period, cross-entity and benchmarking analytics SHALL be served from Lakebase/Power BI.
17. The system SHALL write a nightly task-state snapshot fact to the lake to support point-in-time historical questions.
18. Embedded Power BI SHALL authenticate via Entra ID with row-level security by entity and team, and SHALL display an explicit "data as of" timestamp.

**Notifications**
19. The system SHALL model notifications as four distinct types — assignment, alert, mention, digest — each with independent per-user, per-channel preferences.
20. The system SHALL support digest scheduling, quiet hours with timezone, per-user throttling, and a close-week override that may suspend quiet hours for critical alerts only.
21. Critical alerts (now-late on critical path, escalation, downstream breach) SHALL bypass batching and quiet hours.
22. The system SHALL deduplicate across channels and cancel queued email when the equivalent Teams/in-app action has been taken.
23. Downstream-delay alerts SHALL include: the affected task, old vs new projected BD, the named upstream cause and its owner, the BD slip, whether it breaches the recipient's due date, and a single primary CTA plus acknowledge/re-plan and message-upstream secondaries.
24. The system SHALL send at most one downstream-delay alert per (task, cause) unless the projection moves by ≥1 business day or the cause resolves.
25. The system SHALL provide an in-app inbox that is the durable record of all notifications, with type tabs, unread state, snooze and inline actions.
26. The system SHALL instrument delivery, open and click-through per event type and channel and expose an admin view of notification effectiveness and opt-out rates.

**Actionable cards and audit**
27. Teams/Outlook card actions SHALL be limited to acknowledge, complete, comment, request extension and reassign-to-me.
28. Attestation/sign-off SHALL NOT be executable from a card; the card SHALL deep-link to the app for an Entra-authenticated (step-up capable) sign-off that binds the attestation text version and an evidence hash.
29. Every card-originated action SHALL write a `task_event` recording channel, verified Entra object id, correlation id and card version, and SHALL be idempotent with expiring action tokens.

**Escalation**
30. The system SHALL implement a configurable escalation ladder (owner → owner + delegate + downstream owners → close manager queue → line manager + controller) with per-task-type and per-criticality timing.
31. Escalation SHALL route to the upstream owner when a task is blocked, and SHALL only inform the blocked downstream owner.
32. Owner acknowledgement with a new committed date SHALL pause escalation once; a subsequent miss SHALL escalate immediately.
33. Managers SHALL receive escalations as a daily close-week digest except at the highest tier.
34. Escalation copy SHALL be framed as assistance; escalation counts SHALL be reported at process level and SHALL NOT be surfaced as an individual performance metric.

---

## 7. v1 vs later

**v1 (must ship for the first close):** My Tasks; Close Status Board with BD pivot; Gantt + canvas dependency view with critical path; impact-preview service; in-app inbox; assignment / due-soon / late / downstream-delay / mention notification types; Teams card + email transport with a basic preference page (immediate vs daily digest vs off, quiet hours); sign-off with immutable audit record; evidence upload + completeness flag; baseline due dates + `task_event` log; Actions/Status/Activity CSV export; KPIs limited to % complete, on-time %, late count, at-risk count, evidence completeness.

**v1.5:** aging/bottleneck view; handoff latency; saved/shared views; escalation ladder with acknowledgement; digest tuning + throttling; per-process preference overrides; sign-off completeness view as an audit package export.

**v2:** Power BI embed with cross-period trends, days-to-close history, cycle-time by task type, team benchmarking; reopen rate and first-pass sign-off rate; notification effectiveness admin view; what-if scenario planning on the canvas; predicted-close-date model using historical actuals rather than template durations.

**Explicitly deferred:** mobile app; SMS; ML-based anomaly detection on task duration; public/vendor-facing views.
