# Intent: Finance Workflow, Dependency & Internal Controls Tracker

**Owner:** Alex (Finance, Pinnacle Financial Partners)
**Status:** Draft v0.2 — 2026-09-03
**Companion document:** `REQUIREMENTS.md`

---

## 0. Two pillars, one engine

1. **Dependency planning across finance processes.** Draw the close, regulatory reporting and cross-team handoffs once on a react-flow canvas; instantiate per period against a business-day calendar; alert the specific downstream owners when an upstream item slips.
2. **Internal controls management (ICM).** Maintain the controls library and risk-control matrix (RCM); perform controls as typed tasks with mandatory evidence and independent reviewer sign-off; log deficiencies and remediation; run the quarterly certification cascade; give auditors and examiners scoped read-only access.

They are one product because **a control performance is a task**: owner, business-day due date, dependencies, evidence, sign-off. The graph tells a control owner their reconciliation review is at risk because Loan Ops is late; the library tells the controller that task is a key control over ALLL and the quarter's certification depends on it.

## 1. Problem

Pinnacle's finance and accounting teams run the month-end close, quarterly regulatory reporting (Call Report, FR Y-9C, FR Y-14), the SOX/FDICIA controls program and dozens of cross-team handoffs out of Excel checklists, an Excel RCM, email and Teams. Each checklist is a flat list with an owner, a status and a due date typed for last month. What actually decides whether the close lands on BD+6 and whether the controls program survives an audit is invisible there:

- **Dependencies live in prose.** "Hold until the ALLL model runs." Nobody can answer "if Loan Ops is a day late, who else moves, and which controls and certifications does that put at risk?" without a phone call.
- **Business-day math is manual.** Every roll-forward means retyping dates against this month's holidays; regulatory calendar-day deadlines follow a different rule than BD+n close tasks, and the sheet does not know.
- **Status is stale.** The spreadsheet is a second place to update, so people update Teams instead.
- **Controls and the work that performs them are disconnected.** The RCM says a control exists; the checklist has a row that happens to be it; nothing links the two. Coverage gaps, controls performed without evidence, and performer = reviewer violations are found by the auditor, not the tool.
- **Evidence and sign-off are unstructured.** Proof lives on a share, approval in an email, sub-certification letters in a mailbox. "Who approved this, on what evidence, when" is reconstructed by hand.

Post-merger (Pinnacle + Synovus, ~$117B combined) the bank is a large accelerated filer [to confirm — see open question 17] under SOX 302/404 and a Part 363 institution under FDICIA. Management asserts on ICFR annually, the external auditor attests to it, and the CFO/CEO 302 certification rests on a cascade of sub-certifications from process and subsidiary owners. FDIC's November 2025 Part 363 rule raised the ICFR audit threshold to $5B (effective 1 January 2026) and indexed it to inflation — Pinnacle stays in scope, but the regime is a moving data attribute, not a constant. The close is dual-entity and dual-ledger for a long integration period; Excel does not scale to that, and anything that evidences the close or the controls program is in-scope IT for auditors.

Workiva is the reference: Processes is a hierarchical checklist with business-day due dates and an approval chain, not a graph; Internal Controls Management adds the library, RCM, certifications, sampling and auditor roles on a linked-document platform. Workiva's moat is the document layer; ours is the dependency graph. The ICM object model is standard and can be built minimally; downstream-impact alerting cannot be bought from anyone we reviewed.

## 2. Who it is for

| Persona | Needs | Lands on |
|---|---|---|
| Staff accountant / preparer / control performer (highest traffic) | "What's mine today," attach a workpaper and submit in two clicks, see what upstream item they are waiting on | Personal task list |
| Reviewer / approver | Review queue, evidence side-by-side, return-with-reason, real attestation; independent of the performer by rule | Review queue |
| Accounting manager | Team exceptions by BD, reassign when someone is out, blast radius of a late upstream | Team board |
| Controller / close manager | "Will we make BD+6," critical path, what to escalate | Close status board |
| Control owner / SOX program owner | Controls library and RCM, coverage gaps by significant account, control calendar, issue log, certification readiness | Controls workspace |
| Sub-certifier (process, subsidiary, division owners) | One letter per quarter with questions; exceptions become issues; visible roll-up to the 302 signer | Certification task |
| Regulatory reporting analyst | Schedule-by-schedule checklist on statutory deadlines, dependencies on providers outside finance | Reg-reporting workflow |
| Upstream providers outside finance (Loan Ops, Deposit Ops, Credit/ACL, IT, HR, Tax) | One legible task with a due date and a drop zone, reachable from email or Teams | Deep link |
| Process designer / admin (Alex + 2-4 others) | Canvas, template versioning, roll-forward, calendar admin, control-to-node mapping | Designer |
| Internal audit, external auditor, examiner | Read-only, scoped by entity, process and period range; exportable evidence without the "email the auditor a zip" ritual | Auditor workspace and exports |

## 3. Core value proposition

**One artifact for the diagram, the executable workflow and the control map.** The process is drawn once as a versioned template — nodes carry owner role, BD offset, evidence and sign-off requirements, optionally a control ID; edges *are* the dependencies. Instantiating a period resolves offsets against the holiday calendar, assigns roles to people and creates that period's control performances. Workiva keeps the flowchart in a doc, the checklist in a Process and the control in the RCM; BlackLine has no canvas at all.

**Downstream-impact alerting, including on controls and certifications.** When an upstream task slips past its free float, the engine recomputes over the graph and tells the specific downstream owners: "Your FX revaluation JE is now projected BD+5 (was BD+3) because Treasury's FX rate load slipped; owner J. Ruiz." The same walk flags which control performances and sub-certifications are now at risk. No close-management or ICM vendor we reviewed documents this.

**A defensible system of record for the controls program.** Versioned library and effective-dated RCM; control performances that cannot complete without evidence and an independent reviewer; immutable attestations bound to hashed evidence; a deficiency log with severity ladder and retest; certification campaigns that roll up; append-only audit trail on Azure SQL ledger tables; scoped auditor access and one-click control-binder exports.

The shortest pitch, borrowed from FloQast: **the dashboard replaces the status meeting** — and the audit request list.

## 4. Guiding principles

1. **The grid is where work happens; the canvas is where process is designed.** Contributors land on a task list.
2. **One task engine, typed tasks.** `PLAIN`, `CONTROL_PERFORMANCE`, `CONTROL_TEST`, `CERTIFICATION`, `EVIDENCE_REQUEST`, `REMEDIATION` share scheduling, dependencies, alerting, evidence and audit; a type adds a payload and a completion validator.
3. **Store offsets, resolve dates.** A due date is `(anchor, offset, kind, calendar, time-of-day)`, resolved at instantiation and frozen as a baseline.
4. **Template, control and statement versions are immutable; runs pin a version.** A historical period renders against the control definition in force at the time.
5. **Exactly one accountable owner per task; many preparers.**
6. **Segregation of duties is a domain rule, not a UI hint.** Performer ≠ reviewer, owner ≠ tester, certifier cannot approve their own chain; checked at sign time; overrides are logged compensating-control exceptions.
7. **Blocked is not late**, and **derived flags over canonical status**: late, at-risk, delayed, blocked and control-at-risk are computed; the lifecycle enum stays small.
8. **Digest by default, immediate by exception.** Slip absorbed by float never alerts.
9. **Nothing is ever hard-deleted.** Supersede, void, archive, retire — with actor, timestamp, reason.
10. **The RCM is a derived view, never a stored spreadsheet.** The associations are the data; the matrix is a report.
11. **Meet accountants in Excel and Teams.** Import the checklist and the RCM; deliver actionable Teams cards.
12. **Model only the ~20% of edges that are real handoffs, and only in-scope controls.**
13. **Server-side enforcement of every rule** (cycles, SoD, permissions, completion validators).

## 5. What it is NOT

- **Not a reconciliation or transaction-matching engine** (BlackLine, Adra, Numeric). It tracks *work about* the close and links to the workpaper.
- **Not a GL/ERP integration, flux analysis or XBRL/SEC filing tool.** No narrative authoring or linked-document layer; narratives cite controls by ID and get a stale flag, nothing more.
- **Not a BPMN engine.** A DAG whose edges carry the `hard` and `alert_on_slip` flags (research shorthand: blocks / informs) plus groups is the ceiling.
- **Not a full GRC suite.** ICFR-grade library, RCM, performance, deficiencies and certifications — yes. Risk quantification, multi-framework mapping engines (J-SOX, UK SOX, SCIIF), policy management, vendor risk, continuous-controls monitoring — no.
- **Not a control testing workbench at MVP.** Internal Audit and the co-source firm test in their own workpapers; the tool records a result and workpaper link per control per cycle. A sampling engine only if testing moves in-house.
- **Not a document repository** and **not a real-time co-drawing canvas at MVP.**

## 6. Success metrics

Baseline in Phase 0; cannot claim improvement without a before.

| Metric | Target |
|---|---|
| Close cycle time (business days from BD0 to financials issued, per FR-156) | Hold flat through cutover, then trend toward APQC top quartile (APQC's ~4.8 calendar-day benchmark is a conversion reference only, roughly BD+3 to BD+4) |
| Tasks completed by baseline due BD | >= 90% by cycle 3 |
| Sign-offs executed in-tool (email sign-offs -> 0) | >= 95% at cutover |
| Evidence attach rate on evidence-required tasks and control performances | >= 98% |
| In-scope key controls mapped to a template node | 100% by end of v1 |
| Control performances with independent reviewer sign-off by due BD | >= 95% per quarter |
| SoD exceptions per quarter | Trending to zero; every one justified and reported |
| Sub-certifications returned by due date | 100%, exceptions logged as issues same day |
| Open deficiencies past target remediation date at quarter close | 0 |
| Weekly active assignees during close week | >= 90% |
| Live shadow spreadsheets (checklist and RCM) in scope | 0 |
| Downstream-delay alert lead time | >= 8 business hours |
| Alert precision (acted on / sent) | >= 70%, else retune |
| Auditor acceptance | Internal Audit and the external auditor accept the binder export and scoped read-only access as primary evidence for one full quarter |

## 7. Key risks and assumptions

| Risk / assumption | Mitigation |
|---|---|
| **Second place to update status** — the dominant failure mode | System of record from day 1 of the parallel run; spreadsheet and Excel RCM archived read-only at cutover; leadership reads the tool |
| Controls library migration is the long pole | Phase 0 inventory of where the RCM lives; same map/validate/commit importer as the checklist; control-to-node mapping workshop with the program owner |
| Over-building ICM into a GRC suite | Explicit deferred list (sampling, narrative propagation, SOC 1 module); framework is a data attribute |
| Alert fatigue | Free-float absorption, dedup, debounce, digests, quiet hours; tune in pilot |
| Schedule-engine correctness *is* the product | Materialized business-day table; golden tests over holidays-on-weekends, DST, fiscal boundaries |
| SoD rules unworkable for small teams | Compensating-control override path with approval and a standing exceptions report; confirm with Internal Audit in Phase 0 |
| Platform unknowns: Prisma + Azure SQL managed identity, private endpoints vs browser SAS uploads, Graph `Mail.Send` approval, Teams webhooks retired | Week-1 spikes and approvals; fallbacks: Drizzle, proxy upload, SMTP, Power Automate Workflows |
| In SOX/FDICIA ITGC scope from day one | Ledger and temporal tables, Entra app roles, change management from MVP; register with the application inventory |
| Bus factor of an internal build | Named finance product owner, support channel, documented backlog |
| Assumed: single timezone, calendar fiscal year, Entra P1, ICFR-only controls scope at MVP | Confirm with Alex |

## 8. Phased roadmap

Detailed phasing and MoSCoW priorities are in `REQUIREMENTS.md`; the shape is:

**MVP (~10-12 weeks, one close cycle, one area, one entity).** Dependency pillar: react-flow designer with typed edges and optional control ID per node; versioning and roll-forward with pre-flight; business-day engine with Fed + bank calendars and regulatory anchors; My Tasks, Close Status Board, live canvas, Gantt-lite; review/return and single-step attestation; hashed, scanned evidence in Blob; downstream-delay alerts with digest; Graph email and Teams cards; Entra app roles; ledger audit tables; Excel importer with dependency-candidate review. Controls pillar: controls library imported from the Excel RCM, `CONTROL_PERFORMANCE` with mandatory evidence and performer ≠ reviewer at sign time, `EVIDENCE_REQUEST`, control calendar, tags as the reporting pivot.

**v1 (next 2-3 cycles).** Multi-step chains with quorum; full SoD rules with overrides and exceptions report; escalation ladder; cross-workflow dependencies; Call Report and ALLL/CECL templates; delegation, backups, leaver handling; binder export. Controls: Risk ⟷ Control ⟷ Process ⟷ Account associations and the derived RCM; coverage heat map; issue log with severity ladder, `REMEDIATION` tasks and retest; thin `CONTROL_TEST`; certification campaigns with exception-to-issue and roll-up cascade; readiness, aging and dependency-impact-on-controls views; SOC 1 reliance flag with CUECs; scoped, time-boxed auditor/examiner role.

**Later.** Power BI over Lakeflow CDC; Teams bot; full test-plan and sampling engine only if testing moves in-house; narrative stale-flag (auto-propagation deferred indefinitely); Conditional Access step-up at signing; multiplayer canvas if validated; legal hold UI; inbound API; MRA/MRIA linkage.
