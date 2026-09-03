# Personas, RACI/Task-Role Model, and Permission Design

Research dimension for the internal finance workflow + dependency tracker (Pinnacle Financial Partners). Scope excludes attestation record structure, SoD-at-signing, immutable audit trail internals, and Entra SSO plumbing (covered elsewhere). Focus: who uses this, what role model a task carries, how concurrent inputters work, and how permissions are scoped and operated.

Org context note: Pinnacle and Synovus completed their all-stock merger, creating a combined regional bank operating under both brands ([Pinnacle press release](https://www.pnfp.com/news/news-releases/pinnacle-and-synovus-receive-federal-bank-regulatory-approval-to-combine/), [Synovus](https://www.synovus.com/about-us/news/2026/2026-01-02-pinnacle-and-synovus-complete-merger-to-become-regional-bank-growth-champion)). This is load-bearing for permissions: a merged bank runs dual legal-entity / dual-ledger closes and parallel org hierarchies for a long integration period. Entity scoping is not a "phase 2" nicety — it is day-one.

---

## 1. Persona inventory

For each: what they need, primary view, friction tolerance, abandonment trigger.

**P1. Staff accountant / preparer (highest traffic).** Needs: a short, filtered "what's mine today" list with due dates in BD terms, the ability to attach a workpaper and mark done in under 15 seconds, and to see what upstream input they're waiting on. Primary view: personal task list grouped by BD, not the flowchart. Friction tolerance: very low — they are doing this at 7pm on BD+2. Abandons if: they have to open the graph canvas to find their work, if marking a task done takes more than two clicks, or if the tool asks for fields (memo, category, control ID) that add no value to them.

**P2. Senior accountant / reviewer.** Needs: a review queue of items submitted to them, side-by-side view of the evidence attached, ability to reject back to preparer with a reason, and to see whether their review is what's blocking a downstream owner. Primary view: review queue + a "returned to preparer" bucket. Abandons if: rejection requires re-typing context, or they can't see the prior period's version of the same task.

**P3. Accounting manager (highest traffic, second).** Needs: team-level rollup — who is late, what is at risk, which BD are we compressing. Owns reassignment when someone is out. Primary view: team board / heatmap by BD column with red-amber-green, plus an exception list. Abandons if: the status is stale because people update it in Excel/Teams instead, i.e. if adoption of P1 fails, P3's view is worthless.

**P4. Controller / assistant controller.** Needs: a single close-status page they can screenshot into a leadership update; certainty that everything is signed; the ability to see the critical path and what will move the close date. Low tolerance for detail. Abandons if: the tool cannot answer "are we going to make BD+6" in one screen.

**P5. Financial reporting manager (10-Q/10-K, earnings release).** Needs: dependency lineage from close tasks to disclosure items; hard gates ("earnings release cannot be published until these 12 items are signed"); and the tie-out between a number and the task that produced it. Primary view: the dependency graph, filtered to reporting deliverables.

**P6. Regulatory reporting analyst (Call Report / FR Y-9C).** Needs: a schedule-by-schedule checklist mapped to filing deadlines, dependencies on data providers outside finance, an as-of/period model that handles amended filings and restatements, and evidence retention. Regulatory reports have a distinct calendar (quarter-end + 30/35/40 days, not BD+n from month-end) — see [FR Y-9C instructions](https://www.federalreserve.gov/reportforms/forms/FR_Y-9C20190331_i.pdf), [FDIC Call Report](https://www.fdic.gov/accounting/consolidated-reports-condition-and-income). Abandons if: the tool can only express BD-from-month-end and can't express "35 calendar days after quarter end, moved to next business day."

**P7. Treasury / ALM contributor.** Needs: to be pinged for a handful of inputs (investment portfolio marks, borrowings, hedge accounting entries) without learning the whole app. Occasional user. Abandons if: onboarding friction exceeds the effort of just emailing the file.

**P8. FP&A.** Needs: read access to close status so they know when actuals are final enough to start variance commentary; a "ledger is closed / flash is final" signal. Mostly a consumer of a status flag.

**P9. Upstream data providers outside finance** (loan operations, deposit operations, credit risk/ACL, IT/data engineering, HR for comp accruals, tax). Needs: to receive a task that is *legible without finance context*, with a due date and a place to drop a file; nothing else. These are the users most likely to never log in. Design implication: an email/Teams-first path with deep link, and possibly a token-scoped upload page. Abandons if: they must be provisioned into a finance app, learn a graph UI, or navigate to find their one task.

**P10. SOX / internal audit.** Needs: evidence that a control operated — preparer ≠ approver, sign-off timestamps, evidence attached, exceptions and reopens. Wants export, not screens. Primary view: filtered export / audit report. Read-only.

**P11. External auditor.** Needs: read access to a defined scope (one entity, one period, specified processes) for a bounded window; ability to pull attachments. Should never see unrelated entities or in-flight future periods.

**P12. Regulator / examiner (FDIC, Federal Reserve, state).** Rare, but when they ask, they ask for everything about one process. Practically the same as P11 with a wider scope and a shorter fuse. Design implication: a "produce an exam package for process X, period Y" export that includes the graph, task list, sign-offs, and evidence manifest.

**P13. Workflow designer / process admin.** The power user (likely Alex + 2–4 others). Needs: the react-flow canvas, template versioning, the ability to instantiate a period and roll forward, and to fix a template mid-period without breaking in-flight instances. Highest tolerance for friction, but the least tolerance for *destructive surprise* (editing a template silently mutating live instances).

**P14. Application owner / product owner.** Needs: usage telemetry, the user access review export, the ability to answer IT Risk's questionnaire, and an admin console for entity/calendar/holiday configuration.

### Day in the life — P1 staff accountant, BD+2

7:45am: opens the app to a single page: 6 tasks due today, 2 overdue, 1 blocked. The blocked one shows "waiting on: Loan Ops — charge-off file — due BD+1, late 1 day, owner J. Rivera" with a nudge button. She nudges. 8:10: completes the prepaid amortization JE, drags the Excel workpaper onto the task, clicks Submit for Review; the task moves to S. Patel's queue and she sees three downstream tasks flip from "blocked" to "ready." 11:00: gets a return-to-preparer with a comment on one item; fixes it, re-submits, and the original evidence version is preserved alongside v2. 3:00: her manager reassigns one of her tasks to a colleague because she's covering an ad-hoc request; she gets a notification and it leaves her list. She logs in three times, total time in the app: under 20 minutes. If it is more than that, she reverts to the Excel close calendar.

### Day in the life — P3 accounting manager, BD+2 to BD+3

Opens the team board filtered to her department, sorted by risk. Two reds: an upstream deposit-ops file is late (she can see the downstream blast radius — 4 tasks and one reporting deliverable), and one of her seniors has 9 open items with 3 due today. She reassigns two, extends one due date with a required reason (which is logged), and comments on the late upstream item; the comment notifies the loan ops owner and their manager per the escalation rule. At 4pm she runs the "at risk for BD+6" view for the controller's standup. Her whole interaction is the exception list — she never opens a workflow canvas during close week. She only opens the canvas in the week *after* close, when she's fixing next month's template.

---

## 2. RACI / task-role model

### Core shape

Model roles as a **join table of (task_instance_id, user_or_group_id, role, is_primary)**, not as columns on the task. Columns (`assignee_id`, `reviewer_id`) look simpler and will break the moment Alex needs two inputters — which he has already said he needs.

Role vocabulary (deliberately small — five, mapped to RACI):

| Role | RACI | Semantics |
|---|---|---|
| `owner` | Accountable | Exactly one, always. Accountable for the task being done on time. Default escalation target. Can reassign, can request due-date change. |
| `preparer` | Responsible | 1..n. Does the work, uploads evidence, submits. Multiple allowed — this is the "concurrent inputters" role. |
| `reviewer` | Consulted/Responsible | 0..n, optionally with a quorum rule (any-1, all, or n-of-m). Can return to preparer. |
| `approver` | Accountable (sign-off) | 0..n, quorum rule. Terminal sign-off / attestation. |
| `watcher` | Informed | 0..n. Notification-only, no write. Also auto-populated with downstream task owners. |

Invariant: **exactly one `owner` per task at all times**. This is the single most important modeling decision. Every "multiple assignees" system that lacks it produces diffusion of responsibility — the well-documented failure mode of multi-assignee tools ([Atlassian community](https://community.atlassian.com/forums/App-Central-articles/Best-Practices-for-Assigning-Issues-to-Multiple-Members-in-Jira/ba-p/2528901), [Productive.io](https://help.productive.io/en/articles/5623598-why-can-t-i-assign-multiple-assignees-to-a-task)). Multiplicity lives in `preparer`, not in accountability.

### How comparable products do it, and where they fall short

- **Workiva Processes**: an action has one assignee plus an *optional* approver, with separate due dates for the assignee and the approver; process sequencing is coarse ("all at once" vs "one at a time"); only a process owner can start a process and thereby becomes process manager ([Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)). Shortfall: single assignee per action, and dependency expression is linear rather than a true DAG. That's precisely the gap Alex is trying to fill with react-flow.
- **Numeric / Double-style close tools**: preparer / reviewer / manager triad, configurable per practice, with the ability to enable any combination and rename labels ([Close assignees](https://help.doublehq.com/en/articles/6100782-close-assignees-preparer-reviewer-manager)). Shortfall: the docs are silent on multi-holder of a single role and on who may mark complete — meaning in practice it is one-per-role.
- **BlackLine**: preparer/approver on reconciliations with bulk reassignment tooling as a first-class admin function ([Revelwood on reassignment](https://revelwood.com/blackline-makes-it-easy-to-reassign-reconciliations-from-one-user-to-another/)). Shortfall: strong on reconciliation-shaped work, weaker on arbitrary cross-team dependency graphs.
- **Jira/FloQast-style workarounds**: sub-tasks, checklists with per-item assignees, or a "collaborators" multi-user custom field — the last of which loses notifications and permission integration ([Atlassian](https://community.atlassian.com/forums/App-Central-articles/Best-Practices-for-Assigning-Issues-to-Multiple-Members-in-Jira/ba-p/2528901)).

**Conclusion for design:** implement the pattern the workarounds are groping toward, natively — one accountable owner, plus first-class **checklist items with individual owners** inside a task. This gives partial completion without task explosion.

### Concurrent inputters — the concrete mechanics

1. **Checklist items (sub-items) with individual owners.** A task has 0..n items; each item has one owner, a done flag, timestamp, and optional evidence. Task progress = items done / items total. This is how "three people are inputting on one task" is represented without three tasks.
2. **Who can mark the task done.** Rule: a task may be submitted only when all *required* checklist items are done; the submit action may be performed by the owner or any preparer, but the actor is recorded. Sign-off (approver step) is separate and restricted.
3. **Partial completion states.** `not_started → in_progress (n of m) → submitted → in_review → returned → approved`. "Blocked" and "late/delayed/stopped" are orthogonal flags computed from dependencies and dates, not states — otherwise the state machine explodes.
4. **Two people editing the same task.** Use optimistic concurrency: every task and item row carries a `rowversion`/`xmin` (Azure SQL `rowversion` is native); the API rejects a stale write with 409 and the UI shows a field-level merge prompt. For the *narrative* fields (comments, memo) use append-only comments rather than a shared editable blob — this removes 90% of conflicts. Do not attempt CRDT/OT collaborative editing for v1; the collaboration users actually want is on *different items of the same task*, which is naturally conflict-free at row level. Broadcast presence ("S. Patel is viewing this task") over SignalR/websocket to prevent the surprise, which is cheaper than merging.
5. **Quorum on review/approve.** Store `review_policy` on the task: `any_one` (default), `all`, or `n_of_m`. Regulatory reports frequently need `all`.
6. **Group assignment.** Allow a role holder to be a *group* (an Entra group or in-app team) with a claim/pick-up model: the task appears in every member's queue until one claims it, at which point the claimant becomes the effective owner and the group remains as watcher. This is the right pattern for the outside-finance providers (P9) where finance doesn't know which loan-ops analyst will do it.

---

## 3. Permission model

### Layering

Three layers, applied in order. Do not build a general-purpose ACL engine.

1. **Role (what verbs you may perform)** — a small fixed set of app roles: `Viewer`, `Contributor`, `Reviewer`, `Approver`, `ProcessDesigner`, `ProcessAdmin`, `Auditor`, `AppAdmin`.
2. **Scope (where those verbs apply)** — a tuple of `(legal_entity, department/team, workflow)`. Assignments grant `role @ scope`, with scope wildcards. Scope is hierarchical: entity → department → workflow → task.
3. **Object-level override (the assignment itself)** — being a named preparer/reviewer/approver on a task grants exactly the verbs that role implies *on that task*, regardless of layer 1/2. This is what lets P9 (loan ops) do their one task with only a `Viewer`-level base role.

Rule of thumb: **layers 1 and 2 are Entra-group-driven; layer 3 is in-app assignment.** That split is what keeps the permissions UI comprehensible — an admin never edits per-task ACLs; they edit group membership and workflow assignments.

### Entra integration

Define **app roles** on the app registration and assign **Entra security groups to app roles** rather than emitting a raw `groups` claim. Group claims overflow at 200 groups (JWT) / 150 (SAML) / 6 (implicit) and then arrive as an overage indicator requiring a Graph `transitiveMemberOf` call; app roles avoid this entirely and give you a semantically clean `roles` claim ([Microsoft Learn: configure tokens, group claims and app roles](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles), [secure access control using groups](https://learn.microsoft.com/en-us/entra/identity-platform/secure-group-access-control)). Practical shape: one Entra group per `role @ entity/department` cell (e.g. `APP-FINTRACK-PNFP-Contributor-Controllership`), each mapped to an app role, plus an in-app table resolving group → scope. Always define a baseline role so a user with app access but no group assignment lands as `Viewer`, not as nothing (or worse, everything).

### Proposed permission matrix

V = view; E = edit; ✓ = allowed; ○ = allowed only when named on the object; — = denied.

| Capability | Viewer | Contributor | Reviewer | Approver | ProcessDesigner | ProcessAdmin | Auditor | AppAdmin |
|---|---|---|---|---|---|---|---|---|
| View workflows/tasks in scope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (all scopes) | ✓ |
| View evidence attachments | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit template | — | — | — | — | ✓ | ✓ | — | ✓ |
| Publish template version | — | — | — | — | ○ (own drafts) | ✓ | — | ✓ |
| Instantiate period / roll forward | — | — | — | — | — | ✓ | — | ✓ |
| Edit task fields (dates, desc) | — | ○ | ○ | ○ | — | ✓ | — | ✓ |
| Complete checklist item | — | ○ | ○ | ○ | — | ✓ | — | — |
| Upload evidence | — | ○ | ○ | ○ | — | ✓ | — | — |
| Submit for review | — | ○ | ○ | ○ | — | ✓ | — | — |
| Review / return to preparer | — | — | ○ | ○ | — | ✓ | — | — |
| Sign off / attest | — | — | — | ○ | — | — | — | — |
| Reopen a signed task | — | — | — | — | — | ✓ (reason req.) | — | ✓ (reason req.) |
| Reassign task | — | — | — | — | — | ✓ | — | ✓ |
| Change due date / BD offset in-period | — | — | — | — | — | ✓ (reason req.) | — | ✓ |
| Manage holidays / BD calendar | — | — | — | — | — | ✓ | — | ✓ |
| Manage users, groups, scopes | — | — | — | — | — | — | — | ✓ |
| Export audit trail | — | — | — | — | — | ✓ (own scope) | ✓ (all) | ✓ |

Deliberate choices worth flagging: `AppAdmin` cannot sign off or upload evidence (keeps the technical admin out of the control), `Auditor` is read-everything/write-nothing including evidence but excluding drafts, and `ProcessAdmin` is the only role that can reopen — with a mandatory reason that lands in the audit trail.

### Auditor, external auditor, regulator access

- **Internal audit / SOX (P10):** a permanent `Auditor` app role scoped to all entities, read-only, plus an export endpoint. Precedent: Workiva ships a workspace-level read-only `Viewer` and separate feature-specific admin roles rather than overloading one role ([Workspace roles](https://support.workiva.com/hc/en-us/articles/360036002431-Workspace-roles)).
- **External auditor (P11) and regulator (P12):** do **not** create standing accounts. Use Entra B2B guests provisioned through **entitlement management access packages** with an explicit expiration (e.g. 120 days), approval workflow, access review, and automatic guest-account block/removal after expiry — the documented lifecycle is assignment expiry → block sign-in after a configurable grace → remove guest account, which prevents guest sprawl ([Govern access for external users](https://learn.microsoft.com/en-us/entra/id-governance/entitlement-management-external-users), [Manage external access with entitlement management](https://learn.microsoft.com/en-us/entra/architecture/6-secure-access-entitlement-managment)). Inside the app, an access package maps to `Auditor @ (entity, period-range, workflow-set)` — a *period-bounded* scope, which is a scope dimension internal roles don't need.
- **Fallback for regulators who won't take a login:** the exam-package export (PDF + evidence bundle + manifest with hashes).

---

## 4. Operational realities

**Delegation / out-of-office.** Two distinct mechanisms, and conflating them is a common failure: (a) **Delegate** — a time-boxed grant where user B may act *as themselves* on user A's tasks, with every action recorded as "B, acting as delegate for A." Sign-off/attestation must be *excludable* from delegation by policy, because an attestation is a personal representation. (b) **Backup owner** — a standing per-task or per-workflow-role secondary who receives notifications and can claim the task. Default rule: delegation covers prepare/review; attestation delegation requires explicit ProcessAdmin enablement and is flagged in the audit export.

**Reassignment mid-period.** Must be bulk-capable ("move all of A's open tasks in this period to B"), reason-coded, and must not lose completed checklist items or evidence. BlackLine treats mass reassignment as a first-class admin feature for exactly this reason ([Revelwood](https://revelwood.com/blackline-makes-it-easy-to-reassign-reconciliations-from-one-user-to-another/)). Reassignment of a *signed* task is not reassignment — it is reopen + reassign, and both events are logged.

**Joiner–mover–leaver.** The leaver with 40 open tasks is the acute case. Design: on Entra disable/delete detection (Graph delta or SCIM), the app must (1) immediately revoke sign-in, (2) *not* orphan the tasks — instead flag them `owner_inactive` and route them to the owner's manager or the workflow's default owner group for reassignment within an SLA, (3) preserve the historical record: past sign-offs stay attributed to the departed user forever, and their user record becomes a tombstone, never deleted. Movers are the sneakier case — a transfer from controllership to FP&A changes scope but not identity; the app should recompute scope from group membership on each token, so a mover loses access at their next login without an admin ticket. Revocation SLAs commonly used: privileged access same-day/24h, financial-posting roles within a few business days ([SOX UAR runbook](https://youattest.com/blog/sox-user-access-review-quarterly-certifications/)).

**Quarterly user access review.** Produce a certifiable export per quarter: user, app role(s), scope(s), last login, count of tasks signed in the period, and delegation grants held. Certification is by business owner (does this person still need this) plus application owner (does this role map to least privilege). Keep an immutable snapshot of the roster reviewed plus decisions and remediation links; capture extraction parameters and record counts so the report is defensible as IPE ([YouAttest](https://youattest.com/blog/sox-user-access-review-quarterly-certifications/), [Zluri](https://www.zluri.com/blog/sox-user-access-review)). Practically: build the export in v1 even if the review itself happens in the bank's IGA tool — being unable to produce it is what gets an app flagged.

---

## 5. Numbered requirements

**Roles and assignment**

R-1. Every task instance SHALL have exactly one `owner` at all times; the system SHALL reject any state in which a task has zero or more than one owner.
R-2. A task SHALL support 0..n holders of each of `preparer`, `reviewer`, `approver`, and `watcher`, stored in a task-role assignment table keyed by (task, principal, role).
R-3. A role holder MAY be an individual user or a group; group-assigned tasks SHALL appear in every member's queue until claimed, after which the claimant is the effective responsible party and the group is retained as watcher.
R-4. A task SHALL support 0..n checklist items, each with its own single owner, completion flag, completion timestamp, and optional evidence attachment.
R-5. Task completion percentage SHALL be derived from required checklist items; a task SHALL NOT be submittable while a required item is incomplete.
R-6. Submit-for-review MAY be performed by the task owner or any preparer; the acting principal SHALL be recorded on the submission event.
R-7. Review and approval policies SHALL be configurable per task as `any_one`, `all`, or `n_of_m`.
R-8. Concurrent writes to a task or checklist item SHALL use optimistic concurrency (row version); a stale write SHALL return HTTP 409 with the current server state for UI-side merge.
R-9. Free-text collaboration on a task SHALL be modeled as append-only comments rather than a shared mutable field.
R-10. The UI SHALL display live presence of other users viewing or editing the same task.

**Permissions**

R-11. Authorization SHALL be evaluated as role × scope, plus object-level grants derived from task-role assignment; object-level assignment SHALL grant the verbs of that role on that object irrespective of the user's base scope.
R-12. Scope SHALL be expressible as (legal entity, department/team, workflow) with hierarchical inheritance and wildcards.
R-13. App roles SHALL be declared as Entra app roles with Entra security groups assigned to them; the application SHALL NOT depend on a raw `groups` claim, and SHALL handle group-overage by Graph lookup if groups are ever used.
R-14. A baseline `Viewer` app role SHALL be assigned by default so that no authenticated user is either unauthorized-by-accident or over-privileged-by-default.
R-15. The permission matrix in §3 SHALL be implemented as the v1 capability set; capability checks SHALL be enforced server-side on every API route, never only in the UI.
R-16. `AppAdmin` SHALL NOT be able to sign off, attest, or upload evidence.
R-17. Reopening a signed task, changing a due date in-period, and reassigning SHALL each require a reason code and SHALL emit an audit event.
R-18. An `Auditor` role SHALL provide read access to workflows, tasks, evidence, sign-offs and audit trail across its scope, with no write capability of any kind.
R-19. External auditor and regulator access SHALL be provisioned as time-bounded Entra B2B guests via entitlement-management access packages with a defined expiration, approval, and automatic guest removal on expiry.
R-20. External read-only scope SHALL be bounded by period as well as by entity and workflow.
R-21. The system SHALL support an "examination package" export for a given process and period comprising the workflow diagram, task list, statuses, sign-off records, and an evidence manifest with file hashes.

**Operations**

R-22. The system SHALL support time-boxed delegation in which a delegate acts as themselves on another user's tasks, with all actions attributed as "acting as delegate for X."
R-23. Attestation/sign-off SHALL be excluded from delegation by default and SHALL require explicit administrative enablement, flagged in the audit export where used.
R-24. Each task and each workflow role SHALL support an optional backup owner who receives notifications and may claim the task.
R-25. Bulk reassignment SHALL be supported for all open tasks of a user within a scope and period, preserving completed checklist items, comments, and evidence.
R-26. On detection of a disabled or deleted directory account, the system SHALL immediately revoke access, flag that user's open tasks `owner_inactive`, and route them to a designated reassignment queue with an SLA.
R-27. Historical sign-offs, comments and evidence attributions SHALL be preserved for deactivated users; user records SHALL be tombstoned, never deleted.
R-28. Effective scope SHALL be recomputed from directory group membership at each authentication so that internal transfers lose stale access without manual intervention.
R-29. The system SHALL produce a quarterly user access review export containing user, app roles, scopes, last login, sign-off counts for the period, and active delegations, together with extraction parameters and record counts sufficient for IPE testing.
R-30. Access review results (roster snapshot, certification decisions, remediation actions) SHALL be retained immutably.

**Persona-driven UX requirements**

R-31. The default landing view for a Contributor SHALL be a personal task list, not the workflow canvas.
R-32. A blocked task SHALL display the specific upstream task, its owner, its due date, its lateness, and a one-click nudge action.
R-33. Managers SHALL have a team exception view filterable by department, BD, and risk status, with the downstream blast radius of any late task visible.
R-34. Outside-finance contributors SHALL be able to complete their task (view instruction, upload evidence, mark done) from a deep link with no navigation through the wider application.
R-35. Task instructions SHALL be authored without assumed finance context for tasks assigned to non-finance departments.
R-36. Due dates SHALL be expressible both as business-day offsets from a period anchor and as fixed calendar deadlines with weekend/holiday roll rules, to accommodate regulatory filing deadlines alongside month-end close.

---

## Sources

- [Workiva — Build a process](https://support.workiva.com/hc/en-us/articles/360050581612-Build-a-process)
- [Workiva — Introduction to Processes](https://support.workiva.com/hc/en-us/articles/360047036512-Introduction-to-Processes)
- [Workiva — Workspace roles](https://support.workiva.com/hc/en-us/articles/360036002431-Workspace-roles)
- [Workiva — Understanding roles](https://support.workiva.com/hc/en-us/articles/360036002371-Understanding-roles)
- [Numeric/Double — Close assignees (preparer/reviewer/manager)](https://help.doublehq.com/en/articles/6100782-close-assignees-preparer-reviewer-manager)
- [Revelwood — BlackLine reassignment](https://revelwood.com/blackline-makes-it-easy-to-reassign-reconciliations-from-one-user-to-another/)
- [Atlassian Community — assigning issues to multiple members](https://community.atlassian.com/forums/App-Central-articles/Best-Practices-for-Assigning-Issues-to-Multiple-Members-in-Jira/ba-p/2528901)
- [Productive.io — why you can't assign multiple assignees](https://help.productive.io/en/articles/5623598-why-can-t-i-assign-multiple-assignees-to-a-task)
- [Microsoft Learn — Configure group claims and app roles in tokens](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles)
- [Microsoft Learn — Secure access control using groups in Microsoft Entra ID](https://learn.microsoft.com/en-us/entra/identity-platform/secure-group-access-control)
- [Microsoft Learn — Govern access for external users in entitlement management](https://learn.microsoft.com/en-us/entra/id-governance/entitlement-management-external-users)
- [Microsoft Learn — Manage external access with entitlement management](https://learn.microsoft.com/en-us/entra/architecture/6-secure-access-entitlement-managment)
- [YouAttest — SOX user access review quarterly certifications runbook](https://youattest.com/blog/sox-user-access-review-quarterly-certifications/)
- [Zluri — SOX user access reviews](https://www.zluri.com/blog/sox-user-access-review)
- [Federal Reserve — FR Y-9C instructions](https://www.federalreserve.gov/reportforms/forms/FR_Y-9C20190331_i.pdf)
- [FDIC — Consolidated Reports of Condition and Income](https://www.fdic.gov/accounting/consolidated-reports-condition-and-income)
- [Pinnacle — regulatory approval to combine with Synovus](https://www.pnfp.com/news/news-releases/pinnacle-and-synovus-receive-federal-bank-regulatory-approval-to-combine/)
- [Synovus — merger completion](https://www.synovus.com/about-us/news/2026/2026-01-02-pinnacle-and-synovus-complete-merger-to-become-regional-bank-growth-champion)
