# Review operations implementation plan

Priority: exception management, assignment administration, then notifications.
These close the accountability loop: identify a concern, assign responsibility,
obtain the reviewer's acceptance, and bring outstanding work to the right person.

## 1. Exceptions

- Add version-linked issues with stable IDs, accountable owner, category, status,
  comments, resolution proposal, reviewer acceptance, and immutable event history.
- Enforce object/entity access and expected revisions on every command.
- Block sign-off/finalization while relevant issues remain unresolved. Reopening
  signed work invalidates parents and workflow gates using existing controls.
- Add an Exceptions page for creation, triage, discussion, resolution and acceptance.

## 2. Assignment administration

- Add effective-dated entity/section rules, primary/additional reviewers and backup.
- Resolve rules at publication and preserve the resulting assignment snapshot.
- Require explicit, reasoned reassignment; retain historical decisions/signatures
  while requiring the replacement reviewer to make their own decisions.
- Add scoped administration forms, optimistic revisions, access-change auditing,
  and protection against removing the last administrator or stranding active work.

## 3. Notifications

- Use durable outbox events as inbox items with per-user read/resolution receipts.
- Add reminder preferences, timezone-aware quiet hours, and explicit email opt-out.
- Add authorized, audited, rate-limited nudges; defer delivery during quiet hours.
- Link to the precise assignment/task and display recovery separately from delivery.

## Integration and verification

New aggregate collections are optional for compatibility with existing stored data.
Snapshots explicitly scope every new collection; API signing continues inside the
existing transaction boundary. Add domain tests for state transitions, permissions,
revisions and invalidation, plus browser/HTTP journeys for the new operational loop.
Run the existing regressions and production build. No real email or cloud deployment
is part of implementation verification.

Implementation is delegated to GPT 5.6 Luna at high effort. Root integrates shared
contracts, navigation, access filtering, deep links, end-to-end checks and Git delivery.
