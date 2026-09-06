# WorkEva feature scope

This implementation covers the two features requested for the application:

1. Crowdsourced financial document review and sign-off: publish versioned PDFs, map sections and metrics to reviewers, collect responses and comments, record explicit version-bound signatures, reopen work when needed, and report completion.
2. Workflow attestation diagrams with dependencies: create reusable task diagrams, assign owners and approvers, define hard/advisory prerequisites, instantiate period runs, attach evidence, record attestations, forecast completion, and invalidate downstream attestations when prerequisite work changes.

The application uses Next.js and Node.js. Azure Web Apps is the production hosting target. Azure SQL is the selected operational storage and writeback option; Databricks Lakebase remains an alternative future adapter. Azure Blob Storage holds original PDFs privately. A server-side Databricks API retrieves approved reference data. Local development uses explicitly enabled synthetic fixtures and file persistence.

See [the implementation plan](IMPLEMENTATION_PLAN.md), [the delivered coverage and verification record](IMPLEMENTATION_STATUS.md), and [the Azure runbook](../infra/runbook.md). The separately delivered full PRD and source attachments are not republished in this implementation branch. Existing historical repository documents remain unchanged.
