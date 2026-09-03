# Controls, Attestation, Evidence & Audit Trail — Research (Dimension: `controls`)

**Context:** Internal finance/accounting workflow + dependency tracker for Pinnacle Financial Partners (post-Synovus, ~$117B total assets). Next.js / Node / Azure SQL / Azure Blob / Databricks Lakebase, Azure Web Apps, Entra ID auth.

---

## 0. Why the regulatory posture is stricter than a generic "task tracker"

The Pinnacle–Synovus merger closed and the combined company is a **~$117B bank holding company** ([American Banker](https://www.americanbanker.com/news/pinnacle-emerges-as-117b-bank-after-completing-synovus-deal)). That single fact drives most of the control requirements:

| Regime | Trigger | Consequence for this tool |
|---|---|---|
| SOX 302 | SEC registrant | Quarterly CEO/CFO certification, cascaded down as **sub-certifications**. The tool is a natural sub-cert vehicle. |
| SOX 404(a)/(b) | Large accelerated filer | Management ICFR assessment **plus external auditor opinion on ICFR**. Anything the tool records becomes control evidence and the tool itself becomes in-scope IT. |
| SOX 802 / SEC Rule 17a-4 style retention | SEC registrant | Records relevant to audits/reviews retained **7 years** ([SEC final rule 33-8180](https://www.sec.gov/files/rules/final/33-8180.htm)). |
| FDICIA Part 363 | Insured depository >$1B (top tier >$3B) | Management report on ICFR **and independent auditor attestation on ICFR**; independent audit committee ([BerryDunn](https://www.berrydunn.com/resources-detail/fdicia-reporting-requirements), [Schellman](https://www.schellman.com/blog/soc-examinations/understanding-fdicia-and-bank-internal-controls)). |
| FR Y-14A/Q/M (Category IV, >$100B) | Post-merger asset size | **CFO-level attestation cover page** on capital assessment/stress-test data, with an obligation to report material weaknesses and material errors/omissions promptly ([Federal Reserve attestation cover page](https://www.federalreserve.gov/reportforms/formsreview/FR%20Y14QMAsemiannual_Attestation_final%20redline.pdf)). |
| FFIEC IT Handbook | Bank examination | Log management, integrity protection, retention and independent review expectations ([FFIEC II.C.22 Log Management](https://ithandbook.ffiec.gov/it-booklets/information-security/ii-information-security-program-management/iic-risk-mitigation/iic22-log-management)). |

**Design implication:** this is not "nice-to-have audit logging." If the tool is used to evidence the close and regulatory reporting, then (a) the tool's own records will be pulled as SOX/FDICIA evidence and (b) the tool becomes an in-scope application requiring ITGCs (access, change management, operations). Build accordingly from v1 — retrofitting immutability is essentially impossible.

---

## 1. Attestation / sign-off record model

### 1.1 What an attestation record must capture

The best-codified template for an electronic signature record is **21 CFR Part 11 §11.50** (FDA, life sciences) — not legally binding here, but it is the de facto industry bar auditors recognize, and it is what Workiva/BlackLine-class tools implement. It requires the signature manifestation to contain: the **printed name of the signer**, the **date and time** of signing, and the **meaning of the signature** (review, approval, responsibility, authorship) ([Docusign summary](https://www.docusign.com/blog/21-cfr-pt-11-compliance-electronic-signatures), [Cognidox](https://www.cognidox.com/blog/what-is-fda-21-cfr-part-11)).

**REQ-CTRL-001 — Attestation record fields.** Every sign-off record MUST persist, immutably:
- `attestation_id` (UUID)
- `task_instance_id` + `task_instance_version` (the exact version of the item being affirmed)
- `workflow_instance_id`, `period_id` (e.g. `2026-09 close`), `template_version_id`
- `signer_oid` (Entra ID object ID — stable), `signer_upn`, `signer_display_name_at_signing` (denormalized snapshot; people leave and get renamed)
- `role_at_signing` (Preparer / Reviewer / Approver / Certifier) and `delegated_from_oid` if acting as a delegate
- `attestation_type` enum: `prepared`, `reviewed`, `approved`, `certified`, `rejected`, `reopened`, `waived`
- `statement_id` + `statement_text_snapshot` + `statement_version` — **the full literal text the user saw**, stored inline, not a foreign key to a mutable string
- `signed_at_utc` (server-generated; never client clock) and `signed_at_local` + `tz`
- `source_ip`, `user_agent`, `session_id`, `device_id`/`device_compliant` if available from Entra
- `auth_method` / `amr` claim and `acr`/`acrs` claim proving the auth strength at signing
- `content_hash` — SHA-256 over the canonical serialization of the task state + linked evidence hashes at the moment of signing
- `comment` (optional, required on reject)
- `evidence_ids[]` bound at signing time

**REQ-CTRL-002 — Meaning of signature.** The UI MUST display the exact attestation statement adjacent to the signing control, and the record MUST store the rendered statement verbatim. Statements are versioned; editing a statement creates a new version and never mutates prior records. Example statements to seed:
- Preparer: *"I prepared this item for the period stated, the supporting documentation attached is complete and accurate, and I am not aware of any errors or omissions."*
- Reviewer: *"I independently reviewed this item and its supporting documentation, evaluated it against the stated review procedures, and it is complete and accurate in all material respects."*
- Sub-certifier (SOX 302 cascade): *"To the best of my knowledge, the information within my area of responsibility included in the Company's financial reporting for the period is fairly stated in all material respects; I have disclosed to the Corporate Controller any deficiencies in internal control, any fraud (material or not) involving management or employees with a significant role in internal control, and any material changes in internal control."*
- FR Y-14 style: *"…prepared in good faith using reasonable efforts to conform with the Federal Reserve's instructions and materially correct to the best of my knowledge; I will report material weaknesses in internal controls and any material errors or omissions promptly as identified."*

**REQ-CTRL-003 — Re-authentication / step-up at signing.** Signing MUST require proof of identity at the moment of signing, not merely a live session. Implement via **Entra ID Conditional Access authentication context**: the Node API checks for the required `acrs` value (e.g. `c1`) on the access token; if absent it returns `401` with `WWW-Authenticate: Bearer … error="insufficient_claims", claims=<base64 claims challenge>, cc_type="authcontext"`, and the Next.js client re-acquires a token, triggering MFA/step-up per CA policy ([Microsoft developer guidance](https://learn.microsoft.com/en-us/entra/identity-platform/developer-guide-conditional-access-authentication-context)). Notes: requires Entra ID P1; auth context IDs are `c1`–`c99`; do not hard-code — read via MS Graph. Store the resulting `acrs`/`amr` in the attestation record.
- Cheaper fallback if CA auth context is unavailable: require re-entry of credentials/OTP through MSAL `prompt=login` and record `auth_time`. Do **not** use a "type your name in this box" pseudo-signature as the only control — it fails the identity component.

**REQ-CTRL-004 — Non-transferability.** Sign-off actions MUST be performed by the authenticated principal. Shared/service accounts MUST be blocked from signing (deny list on `signer_oid` by account type). Delegation MUST be explicit, time-boxed, recorded (`delegated_from_oid`, `delegation_id`, effective dates, who granted it), and MUST NOT be usable to bypass SoD.

### 1.2 Segregation of duties: preparer / reviewer / approver

**REQ-CTRL-010 — Distinct-person enforcement.** The system MUST hard-block the same `signer_oid` from occupying two of {Preparer, Reviewer, Approver} on the same task instance. This is checked at *sign time* (not just assignment time) because assignments change.

**REQ-CTRL-011 — Break-glass with visibility.** If the business requires an override (e.g. a one-person team at a subsidiary), it MUST be (a) configurable per task type, not global, (b) require a named compensating-control justification, (c) require approval by a designated control owner, and (d) surface on a standing "SoD exceptions" report that auditors can pull. Never a silent bypass.

**REQ-CTRL-012 — Role assignment is itself a control.** Changes to who can prepare/review/approve a task type MUST be workflow-approved and logged. Entra ID groups SHOULD be the source of truth for role membership (so the bank's existing access recertification/UAR process covers this app), with app-level roles mapped from group claims. Avoid app-local user tables as the authority.

**REQ-CTRL-013 — Reviewer independence signals.** The reviewer MUST NOT be able to edit the underlying task content while in a "review" state without kicking the item back to `in_preparation` (which voids the preparer sign-off and requires re-preparation). Silent reviewer edits destroy the control.

**REQ-CTRL-014 — Precision of review (management review controls).** For review-type tasks, the template MUST allow the control owner to define: the review procedures performed, the threshold/tolerance applied (e.g. "investigate variances > $250k or > 5%"), and the required disposition of outliers. The reviewer's attestation record MUST capture which items exceeded threshold and what was done. MRC documentation that says only "reviewed and approved" is the single most common SOX deficiency; the tool should make the richer record the path of least resistance.

**REQ-CTRL-015 — Multi-signer steps.** Support both "everyone must sign" and "any one of the group must sign" for a step, sequential and parallel — this is the pattern Workiva Processes exposes for certification actions ([Workiva: Build a process with certification actions](https://support.workiva.com/hc/en-us/articles/13887468169620-Build-a-process-with-certification-actions)). Also support **bulk certification**: one letter fanned out to every member of a group, generating an individual attestation record per person.

### 1.3 Re-open, reject, and void flows

**REQ-CTRL-020 — Rejection is a first-class record.** Reject MUST require a comment, MUST create an attestation record of type `rejected`, MUST notify the preparer and any downstream dependents, and MUST NOT delete the prior preparer sign-off — it supersedes it.

**REQ-CTRL-021 — Re-open invalidates downstream sign-offs.** Re-opening a signed task MUST: (a) require a reason code + free text, (b) require approval at or above the level of the highest sign-off being voided, (c) mark all prior attestations on that task as `superseded` (never delete), (d) recompute and propagate to dependent tasks — any downstream task already signed off on the basis of the re-opened upstream MUST be flagged `dependency_invalidated` and its owner notified. This "cascading invalidation" is the control-side twin of the alerting requirement Alex asked for.

**REQ-CTRL-022 — Period lock / hard close.** A period MUST support `soft_close` (no new tasks, edits require approval) and `hard_close` (fully read-only). Post-hard-close changes MUST require a formal reopen at the period level with CFO/Controller-designated approval, and MUST be listed on an exceptions report. Locked periods MUST also lock their evidence (see §3 legal hold).

**REQ-CTRL-023 — Nothing is ever hard-deleted.** No user-facing delete on tasks, attestations, evidence, or comments. Only `void`/`archive` with actor, timestamp and reason. Physical deletion only via retention job (§3.5).

---

## 2. Immutable audit trail

### 2.1 What to log

**REQ-CTRL-030 — Event coverage.** The audit log MUST capture, at minimum:
- Authentication & authorization: sign-in, sign-out, failed auth, step-up challenge issued/satisfied, permission denied
- Role/permission changes; delegation grant/revoke; SoD override
- Template CRUD: create, edit, publish, version, deprecate; every node/edge/dependency change in the react-flow graph
- Instance lifecycle: instantiate from template, roll-forward, task create/edit/reassign/status change, due-date change (BD offset change *and* resulting calendar date change), period open/soft-close/hard-close/reopen
- All attestation events (§1.1), including superseded/void
- Evidence: upload, download/view, delete/void, malware scan result, checksum verification, retention/legal-hold change
- Comments and @mentions: create, edit, delete
- Notification/alert events: alert fired, to whom, on what rule, delivery status, acknowledgment
- Data export and report generation (who exported what, for whom)
- Config changes: holiday calendar edits, BD calendar edits, alert rules, materiality thresholds

FFIEC expects log content sufficient to reconstruct events, protection of logs from alteration, centralization, defined retention, and independent review ([FFIEC II.C.22](https://ithandbook.ffiec.gov/it-booklets/information-security/ii-information-security-program-management/iic-risk-mitigation/iic22-log-management)).

**REQ-CTRL-031 — Event record shape.** Each event: `event_id`, `occurred_at_utc` (server), `recorded_at_utc`, `actor_oid`/`actor_upn`/`actor_display_name`, `on_behalf_of_oid`, `source_ip`, `user_agent`, `session_id`, `correlation_id`/`trace_id`, `entity_type`, `entity_id`, `entity_version_before`/`after`, `action`, `before_json`, `after_json` (or a JSON Patch diff), `reason_code`, `comment`, `app_version`, `schema_version`.

**REQ-CTRL-032 — Before/after values.** For any change to a field that affects a control conclusion (due date, owner, status, threshold, dependency edge, attestation statement), store both before and after. "Field X changed" without values is not audit evidence.

**REQ-CTRL-033 — Actor is never null.** System/automated actions (roll-forward job, alert engine, BD recalculation) MUST log a named service principal and the trigger (schedule, event, or the human who initiated).

### 2.2 Making it tamper-evident

Two complementary mechanisms; recommend **both**.

**A. Platform-native: Azure SQL ledger tables.** Azure SQL Database supports **append-only ledger tables** (INSERT only; UPDATE/DELETE rejected at the engine) and **updatable ledger tables** (system-versioned with a history table). Row changes are SHA-256 hashed, batched into blocks, and chained via a Merkle tree so each block includes the prior block's hash. **Database digests** (JSON with the latest block hash) can be automatically generated and written to **Azure Blob immutable storage or Azure Confidential Ledger**, and `sp_verify_database_ledger` verifies the chain and detects tampering ([Microsoft Azure SQL Dev Corner](https://devblogs.microsoft.com/azure-sql/using-ledger-in-azure-sql-database/), [SQLServerCentral](https://www.sqlservercentral.com/articles/database-ledger-in-sql-server-2022)).

**REQ-CTRL-040.** The `audit_event` and `attestation` tables MUST be **append-only ledger tables**. Task/workflow state tables SHOULD be **updatable ledger tables**. Automatic digest generation MUST be enabled with digests written to an immutable (locked, time-based retention) blob container. A scheduled job MUST run ledger verification at least monthly and on demand before an audit, with the verification result itself logged.
- Caveats to design around: ledger tables cannot be dropped/altered freely, some schema changes are restricted, and enabling ledger on a database is effectively irreversible for those tables. Model the schema carefully first; use a `payload_json` column for evolving fields rather than frequent DDL.

**B. Application-layer HMAC hash chain (portable, also covers Lakebase/Postgres).** If any audit data lands in Databricks Lakebase (Postgres) rather than Azure SQL, replicate the property in app code: each row carries `sequence_number` (monotonic per tenant/period), `prev_entry_hash`, `entry_hash = HMAC-SHA256(key, canonical_string)`, and `hmac_schema_version` so old rows verify against their original canonicalization. Serialize concurrent appends with a per-scope advisory lock (`pg_advisory_xact_lock`) to prevent chain forks. Revoke UPDATE/DELETE from the app role; add triggers blocking modification. Periodically anchor the chain head to immutable object storage / a KMS-signed artifact so a compromised app instance cannot silently rewrite history ([tracehold.ai HMAC chain design](https://tracehold.ai/blog/immutable-audit-log-hmac-hash-chain/), [DesignGurus on Merkle audit logs](https://www.designgurus.io/answers/detail/how-do-you-design-tamperevident-audit-logs-merkle-trees-hashing)).

**REQ-CTRL-041.** HMAC keys MUST live in Azure Key Vault (HSM-backed), never in app config or the database. Key rotation MUST be versioned so historical entries remain verifiable.

**REQ-CTRL-042 — Least privilege at the data tier.** The application's SQL identity MUST have no `DELETE` and no `UPDATE` on audit/attestation tables. DBA/elevated access to production MUST go through PIM/JIT with its own approval trail, and those sessions MUST be logged to a system outside the app (Azure SQL Auditing → Log Analytics / immutable storage). "The DBA can edit the audit table" is the finding auditors reach for first.

**REQ-CTRL-043 — Clock integrity.** All timestamps MUST be server-side UTC from a synchronized source; client-supplied timestamps MUST be rejected. Store the display timezone separately for user-facing rendering.

**REQ-CTRL-044 — Log retention & availability.** Audit and attestation records MUST be retained a minimum of **7 years** to satisfy SOX 802 / SEC Rule 17a-4-style retention for records relevant to audits and reviews ([SEC 33-8180](https://www.sec.gov/files/rules/final/33-8180.htm)) — confirm against the bank's own records retention schedule, which may be longer. Records MUST remain queryable (not just restorable from backup) for at least the current + 3 prior fiscal years.

---

## 3. Evidence handling (PDF / Excel upload)

### 3.1 Ingest and integrity

**REQ-CTRL-050 — Upload path.** Files MUST be uploaded directly to Azure Blob Storage via short-lived, **user-delegation SAS** (Entra-backed, not account-key SAS), scoped to a single blob path, write-only, ≤15 minutes. The Node API issues the SAS after authorizing the user against the task; the browser PUTs directly (keeps large Excel files off the app tier).

**REQ-CTRL-051 — Checksum.** The client SHOULD send `Content-MD5`; the server MUST compute and store **SHA-256** of the stored blob and persist it on the evidence record. Any later read MUST be verifiable against the stored hash. The hash is what binds evidence to an attestation (`content_hash` in REQ-CTRL-001).

**REQ-CTRL-052 — Malware scanning.** Uploaded blobs MUST be scanned before becoming visible/downloadable. Use **Microsoft Defender for Storage on-upload malware scanning**: triggered by `BlobCreated`/`BlobRenamed`, in-memory scan with Defender AV, results surfaced via **blob index tags**, Event Grid, security alerts, and Log Analytics; supports built-in soft-delete of malicious blobs or custom quarantine via Event Grid + Logic Apps ([Microsoft docs](https://learn.microsoft.com/en-us/azure/defender-for-cloud/on-upload-malware-scanning)).
- Operational limits to design for: throughput up to **50 GB/min per storage account**; default monthly cap **10 TB** per account; scan latency varies with file size — the UI MUST show a `scanning` state and MUST NOT allow attestation against unscanned evidence.
- Quarantine pattern: upload to a `quarantine` container; on `Malware Scanning scan result: No threats found`, an Event Grid-triggered function copies/moves the blob to the immutable `evidence` container and marks the evidence record `available`. On a malicious verdict, mark `blocked`, notify the uploader and security, and log the event.

**REQ-CTRL-053 — File type & size policy.** Allowlist by both extension and sniffed content type: PDF, XLSX/XLSM (flag macros), XLS, CSV, DOCX, PNG/JPG, MSG/EML. Reject executables and archives by default. Enforce a per-file cap (suggest 250 MB) and a per-task total. Strip nothing — evidence must be the original bytes.

**REQ-CTRL-054 — Original preservation & rendering.** The stored blob MUST be byte-identical to what the user uploaded. Any preview/rendering MUST be a derived artifact stored separately and clearly labeled. Never re-save an Excel file server-side (it changes formulas/values and destroys evidentiary value).

### 3.2 Binding evidence to a task version

**REQ-CTRL-060 — Version binding.** Evidence MUST attach to a specific `task_instance_version`, and the attestation MUST record the exact set of `evidence_id` + `content_hash` present at signing. Adding, replacing, or removing evidence after sign-off MUST either (a) be blocked, or (b) mark the attestation `evidence_changed_after_signing` and require re-attestation. The audit export must be able to answer: *"show me exactly what the approver was looking at when they approved."*

**REQ-CTRL-061 — Evidence versioning.** Replacing a file creates version N+1; prior versions remain retrievable and remain bound to the attestations that referenced them. Blob versioning + version-level immutability supports this natively.

**REQ-CTRL-062 — IPE metadata.** Because most evidence will be **Information Produced by the Entity**, the upload form MUST capture IPE attributes: source system, report/query name, **report parameters used** (date ranges, entity/legal-entity filters, inclusions/exclusions), run date/time, who ran it, export format, and how completeness & accuracy were validated (record count or dollar total agreed to a source). Auditors classify IPE by risk — ad hoc queries (high), custom reports (medium), canned reports (low) — and expect parameters plus screenshots or a rerun as support ([Armanino on IPE](https://www.armanino.com/articles/information-produced-by-the-entity-ipe-audit-compliance/), [Schneider Downs IPE 101](https://resources.schneiderdowns.com/hubfs/PDFs/Risk%20Advisory/2024_RAS_Whitepaper_IPE.pdf), [KPMG: IPE audits and inspections](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2023/ipe-audits-inspections.pdf)).
- Make `ipe_risk_tier` a required field on evidence attached to control-relevant tasks; make the completeness/accuracy check fields **required** for high-risk tiers. This is a differentiator versus a generic file attachment and directly reduces SOX findings.

### 3.3 Immutability / WORM

Azure Blob immutable storage provides WORM via **time-based retention policies** (1 day–400 years) and **legal holds**, at **container scope** or **version scope** (version scope requires blob versioning; precedence blob → container → account). A **locked** time-based policy is the SEC 17a-4(f)-compliant configuration; unlocked policies are for testing and Microsoft recommends locking within 24 hours. Cohasset Associates assessed the feature as meeting **SEC 17a-4(f), FINRA 4511, and CFTC 1.31(c)-(d)**. Each container keeps an audit log of policy commands (user ID, command, timestamps, retention interval) ([Microsoft: immutable storage overview](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)).

**REQ-CTRL-070.** Evidence containers MUST have a **locked time-based retention policy** of at least 7 years. Recommend **version-level immutability** so individual evidence versions carry their own policy and retention can start from the period close date rather than upload date.

**REQ-CTRL-071 — Legal hold.** The system MUST expose a **legal hold** action (litigation, regulatory exam, restatement) applied per period, per workflow, or per evidence item, propagating to the underlying blobs with a tag (case ID). Hold placement/removal MUST be restricted to Legal/Compliance roles and audit-logged. Held items MUST be excluded from retention deletion regardless of age.

**REQ-CTRL-072 — Known constraints to design for:**
- Containers with locked policies can only be deleted when empty; accounts with version-level WORM likewise. Plan container naming/lifecycle accordingly (e.g. one container per fiscal year).
- Immutability is **incompatible** with point-in-time restore, last-access tracking, NFS 3.0, and SFTP; version-level immutability disables inventory policies.
- **Soft delete interacts badly**: soft-deleted blobs are permanently removed when soft-delete retention expires even if under an immutability policy. Do not rely on soft delete as the retention mechanism.
- Append-blob workloads need `AllowProtectedAppendBlobWrites`; relevant if audit logs are streamed as append blobs.

**REQ-CTRL-073 — Encryption & residency.** Storage MUST use encryption at rest with **customer-managed keys** in Key Vault if the bank's standard requires it, TLS 1.2+ in transit, private endpoints (no public blob endpoint), and firewall rules restricting access to the app's VNet. Blob public access MUST be disabled at the account level. Access to evidence MUST always be brokered by the app (short-lived read SAS after an authorization check) — never a durable shareable URL.

### 3.4 Access logging on evidence

**REQ-CTRL-074.** Every evidence **view/download** MUST be logged (who, when, IP, which version). This is both an FFIEC expectation and the answer to "who saw the pre-close numbers." Enable Azure Storage diagnostic logging to Log Analytics as a second, independent record.

### 3.5 Retention & disposition

**REQ-CTRL-075.** A retention schedule MUST be configurable per record class (attestations, audit events, evidence, comments, notifications) with a default of 7 years from period close. Disposition MUST be a reviewed, approved, logged job — never ad hoc. Items under legal hold MUST be skipped, and the skip logged.

---

## 4. Collaboration: comments, @mentions, concurrency

**REQ-CTRL-080 — Comments are records.** Comment threads attach to a task instance (and optionally to a specific evidence item or a specific attestation). Comments MUST be immutable-by-default: edits create a new revision with the prior text retained and visible ("edited" indicator + history); deletes are soft with actor/timestamp/reason. Comments are discoverable in litigation and examinations — treat them as records, and warn users of that in the UI.

**REQ-CTRL-081 — @mentions.** `@user` and `@group` (Entra group) mentions MUST resolve against Entra, create a notification, and be recorded as a mention event. Mentioning a user MUST NOT grant them access; if the mentioned user lacks access, the system offers a request-access flow rather than leaking content in the notification. **Notification bodies MUST NOT contain financial figures or evidence content** — link only. Email is the leakiest surface in the whole design.

**REQ-CTRL-082 — Rejection/re-open comments are mandatory** and are surfaced in the audit export alongside the attestation record.

**REQ-CTRL-083 — Concurrent editing integrity.** Because multiple inputters work the same workflow simultaneously: use optimistic concurrency (`rowversion` / ETag) on task and template updates and return `409` with a diff on conflict; never last-write-wins silently. Every accepted write increments `task_instance_version` and emits an audit event. For the react-flow template canvas, either lock a template to one editor at a time (simplest, defensible) or use CRDT/OT with per-operation attribution — but attribution per change is non-negotiable for the audit trail.

**REQ-CTRL-084 — Template change control.** Templates are the control design. Editing a **published** template MUST create a new version in `draft`; publishing MUST require approval by a designated control owner; instantiated periods MUST record which `template_version_id` they were created from and MUST NOT silently drift when the template changes. Provide a template version diff view (nodes/edges/owners/BD offsets added, removed, changed) — this is what auditors use to test control design changes year over year.

---

## 5. Reporting for auditors — control evidence export

This is the feature that determines whether internal audit and the external auditor accept the tool. Make it first-class, not an afterthought.

**REQ-CTRL-090 — Control evidence package (per task instance).** One-click generation of a PDF "control binder" containing: task identity (workflow, period, template version), description and review procedures, BD offset and resolved calendar due date, actual completion timestamps, the full sign-off chain (each attestation with name, role, UTC timestamp, statement text, auth method), all comments, the evidence manifest (filename, size, SHA-256, upload time, uploader, IPE metadata, scan result), and the complete audit event timeline. Each page footered with generation timestamp, generating user, and a hash of the package.

**REQ-CTRL-091 — Sample-based export.** Auditors test samples. The tool MUST let an auditor filter (period range, workflow, task type, control ID, owner, status) and export the matching population **and** the selected sample, with a stated population count so completeness of the population can itself be evidenced. Export formats: PDF binder + CSV/XLSX of the underlying rows + a ZIP of the evidence files, with a manifest listing hashes.

**REQ-CTRL-092 — Read-only auditor role.** A dedicated `Auditor` role with read access to everything in scope, no ability to edit, sign, or comment, whose every view/export is logged. Scoped by entity/period so external auditors see only what's granted. This avoids the anti-pattern of finance staff screenshotting the system for the auditor (which is itself unreliable IPE).

**REQ-CTRL-093 — Standing control reports.** Ship these out of the box:
- Sign-off status by period (open / prepared / reviewed / approved / rejected / overdue)
- On-time completion vs BD due date, with late/delayed/stopped counts by owner and by workflow
- Items completed after period close or after the sign-off deadline
- Re-opened items and their justifications
- SoD override exceptions
- Attestations signed by a delegate
- Evidence missing on tasks flagged `evidence_required`
- Evidence changed after sign-off
- Users with signing authority, and changes to that population during the period (feeds access recertification)
- Dependency-invalidation events (downstream sign-offs voided by upstream re-open)

**REQ-CTRL-094 — Population completeness.** Every export MUST include the query parameters used, the row count, the extraction timestamp, and the extracting user — because the export is itself IPE for the auditor and will be challenged on completeness and accuracy ([Armanino](https://www.armanino.com/articles/information-produced-by-the-entity-ipe-audit-compliance/)). Bake the IPE header into the report so finance doesn't have to hand-document it.

**REQ-CTRL-095 — Ledger verification report.** Expose the Azure SQL ledger digest verification result (last run, outcome, digest locations) as an auditor-visible report. This is the single strongest argument that the tool's own records are reliable, and it is what converts the app from "a spreadsheet with extra steps" to a system of record.

---

## 6. The tool as an in-scope application (ITGC)

If the close is evidenced here, the external auditor will scope the app for ITGCs. Anticipate:

**REQ-CTRL-100 — Access.** Entra ID SSO + MFA, conditional access, role-based authorization enforced server-side on every endpoint (never trust the client), quarterly user access reviews with an in-app attestation workflow (dogfood it), automated deprovisioning via Entra group membership, no shared accounts, PIM/JIT for admin.

**REQ-CTRL-101 — Change management.** Source control, PR review with a second approver, separated dev/test/prod, no developer write access to prod data, release approvals recorded, and an in-app `app_version` stamped on every audit event so a control failure can be tied to a release.

**REQ-CTRL-102 — Operations.** Backup/restore tested annually, DR RPO/RTO defined, job monitoring and failure alerting for the roll-forward, BD-date recalculation, alerting, and malware-scan pipelines. A silently failed alert job is a control failure — job outcomes MUST be logged and monitored.

**REQ-CTRL-103 — Segregation between config and data.** Changing the holiday calendar, a BD offset, an alert threshold, or an attestation statement changes control operation. These MUST be approver-gated, versioned, effective-dated, and audit-logged with before/after.

---

## 7. Priority guidance for v1

Must be in v1 (retrofitting is prohibitive):
1. Append-only attestation + audit event tables (ledger tables), server-side timestamps, actor from Entra token.
2. Attestation record with verbatim statement snapshot, content hash, and evidence binding.
3. Preparer/reviewer/approver distinct-person enforcement at sign time.
4. Evidence to Blob with SHA-256, Defender malware scan gate, locked retention policy on the container.
5. Re-open/reject flows that supersede rather than delete, with cascading downstream invalidation.
6. Optimistic concurrency with `409` + version increments.

Can be v2:
- CA authentication-context step-up (start with `prompt=login` + recorded `auth_time`).
- Full auditor self-service export portal (start with a per-task PDF binder + CSV).
- Legal hold UI (start with an ops runbook applying holds directly in Azure).
- Ledger digest auto-verification report (start with a monthly manual `sp_verify_database_ledger` run).
- Comment revision history UI (start with immutable comments, no edit).

---

## Sources

- [Microsoft — Overview of immutable storage for blob data](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)
- [Microsoft — On-upload malware scanning (Defender for Storage)](https://learn.microsoft.com/en-us/azure/defender-for-cloud/on-upload-malware-scanning)
- [Microsoft — Using Ledger in Azure SQL Database](https://devblogs.microsoft.com/azure-sql/using-ledger-in-azure-sql-database/)
- [SQLServerCentral — Database Ledger in SQL Server 2022](https://www.sqlservercentral.com/articles/database-ledger-in-sql-server-2022)
- [Microsoft — Developer guidance for Conditional Access authentication context](https://learn.microsoft.com/en-us/entra/identity-platform/developer-guide-conditional-access-authentication-context)
- [FFIEC IT Handbook — II.C.22 Log Management](https://ithandbook.ffiec.gov/it-booklets/information-security/ii-information-security-program-management/iic-risk-mitigation/iic22-log-management)
- [FFIEC IT Handbook — Audit booklet](https://ithandbook.ffiec.gov/it-booklets/audit)
- [SEC — Final Rule 33-8180, Retention of Records Relevant to Audits and Reviews](https://www.sec.gov/files/rules/final/33-8180.htm)
- [Federal Reserve — FR Y-14Q/M and FR Y-14A semi-annual Attestation Cover Page](https://www.federalreserve.gov/reportforms/formsreview/FR%20Y14QMAsemiannual_Attestation_final%20redline.pdf)
- [BerryDunn — FDICIA Reporting Requirements](https://www.berrydunn.com/resources-detail/fdicia-reporting-requirements)
- [Schellman — Understanding FDICIA & Bank Internal Controls](https://www.schellman.com/blog/soc-examinations/understanding-fdicia-and-bank-internal-controls)
- [CBIZ — FDIC Raises FDICIA Thresholds: Why Banks Should Keep Testing ICFR](https://www.cbiz.com/insights/article/fdic-raises-fdicia-thresholds-why-banks-should-keep-testing-icfr)
- [Armanino — What's Information Produced by the Entity (IPE)?](https://www.armanino.com/articles/information-produced-by-the-entity-ipe-audit-compliance/)
- [Schneider Downs — IPE 101 whitepaper (PDF)](https://resources.schneiderdowns.com/hubfs/PDFs/Risk%20Advisory/2024_RAS_Whitepaper_IPE.pdf)
- [KPMG — IPE audits and inspections (PDF)](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2023/ipe-audits-inspections.pdf)
- [Workiva — Introduction to Certifications](https://support.workiva.com/hc/en-us/articles/13949910788244-Introduction-to-Certifications)
- [Workiva — Build a process with certification actions](https://support.workiva.com/hc/en-us/articles/13887468169620-Build-a-process-with-certification-actions)
- [Workiva — Enhancing Compliance with Audit Trails](https://www.workiva.com/blog/enhancing-compliance-with-audit-trails)
- [Docusign — 21 CFR Part 11 compliance and electronic signatures](https://www.docusign.com/blog/21-cfr-pt-11-compliance-electronic-signatures)
- [Cognidox — What is FDA 21 CFR Part 11?](https://www.cognidox.com/blog/what-is-fda-21-cfr-part-11)
- [tracehold.ai — Immutable audit log with HMAC hash chaining](https://tracehold.ai/blog/immutable-audit-log-hmac-hash-chain/)
- [DesignGurus — Designing tamper-evident audit logs (Merkle trees, hashing)](https://www.designgurus.io/answers/detail/how-do-you-design-tamperevident-audit-logs-merkle-trees-hashing)
- [Pathlock — SOX 302 certifications](https://pathlock.com/learn/sox-302/) and [SOX data retention requirements](https://pathlock.com/learn/sox-data-retention-requirements/)
- [American Banker — Pinnacle emerges as $117B bank after completing Synovus deal](https://www.americanbanker.com/news/pinnacle-emerges-as-117b-bank-after-completing-synovus-deal)
