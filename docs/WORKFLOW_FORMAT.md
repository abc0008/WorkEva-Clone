# Workflow definitions

The workflow designer uses React Flow (`@xyflow/react`). JSON is the canonical portable definition; YAML represents the same data. The visual editor and source editor operate on the same nodes and dependency edges. This is a WorkEva format, inspired by the workflow-as-data approach; it does not import n8n workflows.

A definition contains `schemaVersion: 1`, `name`, `nodes`, and `edges`. See [the example JSON](../examples/quarterly-certification.json) and [equivalent YAML](../examples/quarterly-certification.yaml).

## Authoring

Import a JSON or YAML file to create a new draft, or edit the source and apply it to the current draft. Validation errors leave the existing graph intact. Download either format to keep definitions in Git or move them between environments. Exports include current node positions and dependency settings.

Published templates remain immutable. Importing their exported definition creates a separate draft. Publication and starting a workflow run remain explicit actions.

## Schema

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer `1`; unsupported versions are rejected. |
| `name` | Template display name. |
| `nodes` | Workflow steps. |
| `edges` | Directed dependencies between step IDs. |

Each node uses these fields:

| Field | Meaning |
| --- | --- |
| `id`, `title` | Stable step ID and display title. |
| `type` | `task`, `attestation`, `milestone`, `input`, or `document_gate`. |
| `ownerId`, `entity` | Existing application user ID and entity scope. |
| `instructions`, `statement` | Work instructions and attestation statement. |
| `dueOffset`, `duration` | Nonnegative integer business-day scheduling values. |
| `evidenceRequired` | Whether evidence is required. |
| `position` | Optional `{ "x": number, "y": number }` layout; omitted positions receive deterministic defaults. |
| `approverId` | Optional independent approver user ID. |
| `packageId`, `documentVersionId` | Document references; both are required for a document gate. |

Each edge contains `id`, `source`, `target`, `hard`, and `lag`. `source` and `target` reference node IDs. A hard dependency blocks downstream work until its prerequisite is satisfied. Advisory dependencies inform scheduling. `lag` is a nonnegative integer business-day delay.

Duplicate IDs, dangling edges, self-links, cycles, invalid values, unknown properties, and unsupported versions are rejected. YAML parsing rejects duplicate keys, custom tags, and multiple documents, with bounded input and alias handling.

Definitions contain no template identity, publication status, runtime completion, evidence records, signatures, or audit history. Saving rechecks active owners, independent approvers, entity permissions, and document references on the server. The sample IDs match the local demo; replace them with valid IDs when moving to another environment.

## API

`POST /api/commands` accepts:

```json
{
  "type": "saveTemplate",
  "definition": {
    "schemaVersion": 1,
    "name": "My workflow",
    "nodes": [],
    "edges": []
  }
}
```

For an existing draft, include `templateId` and `expectedRevision`. Omit `templateId` to create a new draft. The existing `name`/`nodes`/`edges` command form remains supported. YAML is parsed into the canonical object before submission. Existing authentication, same-origin protection, optimistic concurrency, and transactional storage apply.
