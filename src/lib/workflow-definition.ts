import YAML from "yaml";
import type { Dependency, WorkflowNode } from "./types";

/** The intentionally small, portable representation of a workflow template. */
export type WorkflowDefinition = {
  schemaVersion: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: Dependency[];
};

export type WorkflowDefinitionFormat = "json" | "yaml";

const NODE_TYPES = [
  "task",
  "attestation",
  "milestone",
  "input",
  "document_gate",
] as const;
const NODE_KEYS = new Set([
  "id",
  "title",
  "type",
  "ownerId",
  "entity",
  "instructions",
  "dueOffset",
  "duration",
  "evidenceRequired",
  "approverId",
  "statement",
  "position",
  "packageId",
  "documentVersionId",
]);
const POSITION_KEYS = new Set(["x", "y"]);
const EDGE_KEYS = new Set(["id", "source", "target", "hard", "lag"]);
const DEFINITION_KEYS = new Set(["schemaVersion", "name", "nodes", "edges"]);
const MAX_COLLECTION_SIZE = 10_000;
const MAX_SOURCE_SIZE = 1_000_000;

function invalid(message: string): never {
  throw new Error(`Invalid workflow definition: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
) {
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      invalid(`${label} contains unknown property '${key}'.`);
}

function text(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0)
    invalid(`${label} must be a non-empty string.`);
  if (value.length > max) invalid(`${label} is too long.`);
  return value;
}

function optionalText(
  value: unknown,
  label: string,
  max = 10_000,
): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label, max);
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  )
    invalid(`${label} must be a finite, nonnegative integer.`);
  return value;
}

function stringAllowEmpty(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  if (value.length > max) invalid(`${label} is too long.`);
  return value;
}

function position(
  value: unknown,
  label: string,
  index: number,
): { x: number; y: number } {
  if (value === undefined) {
    // Stable layout means the same definition always opens in the same place.
    return { x: (index % 3) * 260, y: Math.floor(index / 3) * 150 };
  }
  const input = record(value, label);
  assertKeys(input, POSITION_KEYS, label);
  if (!("x" in input) || !("y" in input))
    invalid(`${label} must contain x and y.`);
  if (typeof input.x !== "number" || !Number.isFinite(input.x))
    invalid(`${label}.x must be finite.`);
  if (typeof input.y !== "number" || !Number.isFinite(input.y))
    invalid(`${label}.y must be finite.`);
  return { x: input.x, y: input.y };
}

function node(value: unknown, index: number): WorkflowNode {
  const input = record(value, `nodes[${index}]`);
  assertKeys(input, NODE_KEYS, `nodes[${index}]`);
  const id = text(input.id, `nodes[${index}].id`, 200);
  const type = input.type;
  if (
    typeof type !== "string" ||
    !(NODE_TYPES as readonly string[]).includes(type)
  )
    invalid(`nodes[${index}].type is unsupported.`);
  if (typeof input.evidenceRequired !== "boolean")
    invalid(`nodes[${index}].evidenceRequired must be boolean.`);
  return {
    id,
    title: text(input.title, `${id}.title`, 500),
    type: type as WorkflowNode["type"],
    ownerId: text(input.ownerId, `${id}.ownerId`, 200),
    entity: text(input.entity, `${id}.entity`, 200),
    instructions: stringAllowEmpty(
      input.instructions,
      `${id}.instructions`,
      10_000,
    ),
    dueOffset: nonnegativeInteger(input.dueOffset, `${id}.dueOffset`),
    duration: nonnegativeInteger(input.duration, `${id}.duration`),
    evidenceRequired: input.evidenceRequired,
    ...(optionalText(input.approverId, `${id}.approverId`, 200)
      ? { approverId: input.approverId as string }
      : {}),
    statement: text(input.statement, `${id}.statement`, 10_000),
    position: position(input.position, `${id}.position`, index),
    ...(optionalText(input.packageId, `${id}.packageId`, 200)
      ? { packageId: input.packageId as string }
      : {}),
    ...(optionalText(input.documentVersionId, `${id}.documentVersionId`, 200)
      ? { documentVersionId: input.documentVersionId as string }
      : {}),
  };
}

function edge(value: unknown, index: number): Dependency {
  const input = record(value, `edges[${index}]`);
  assertKeys(input, EDGE_KEYS, `edges[${index}]`);
  if (typeof input.hard !== "boolean")
    invalid(`edges[${index}].hard must be boolean.`);
  return {
    id: text(input.id, `edges[${index}].id`, 200),
    source: text(input.source, `edges[${index}].source`, 200),
    target: text(input.target, `edges[${index}].target`, 200),
    hard: input.hard,
    lag: nonnegativeInteger(input.lag, `edges[${index}].lag`),
  };
}

/** Validate and normalize a portable definition. Throws an Error on any invalid input. */
export function validateWorkflowDefinition(input: unknown): WorkflowDefinition {
  const root = record(input, "definition");
  assertKeys(root, DEFINITION_KEYS, "definition");
  if (root.schemaVersion !== 1) invalid("schemaVersion must be 1.");
  const name = text(root.name, "name", 500);
  if (!Array.isArray(root.nodes) || root.nodes.length > MAX_COLLECTION_SIZE)
    invalid("nodes must be an array with at most 10000 entries.");
  if (!Array.isArray(root.edges) || root.edges.length > MAX_COLLECTION_SIZE)
    invalid("edges must be an array with at most 10000 entries.");
  const nodes = root.nodes.map((value, index) => node(value, index));
  const edges = root.edges.map((value, index) => edge(value, index));
  const nodeIds = new Set<string>();
  for (const value of nodes) {
    if (nodeIds.has(value.id)) invalid(`duplicate ID '${value.id}'.`);
    nodeIds.add(value.id);
  }
  // Node and edge identifiers live in separate namespaces.  In particular,
  // never use an edge id while resolving endpoints: doing so can make a
  // malformed edge look like a node and crash graph traversal.
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const value of edges) {
    if (edgeIds.has(value.id)) invalid(`duplicate edge ID '${value.id}'.`);
    edgeIds.add(value.id);
    if (value.source === value.target) invalid("self links are not allowed.");
    if (!nodeIds.has(value.source) || !nodeIds.has(value.target))
      invalid(`edge '${value.id}' references an unknown node.`);
    if (pairs.has(`${value.source}\u0000${value.target}`))
      invalid(`duplicate dependency '${value.source} -> ${value.target}'.`);
    pairs.add(`${value.source}\u0000${value.target}`);
  }
  const indegree = new Map(nodes.map((item) => [item.id, 0]));
  const outgoing = new Map(nodes.map((item) => [item.id, [] as string[]]));
  for (const value of edges) {
    indegree.set(value.target, (indegree.get(value.target) ?? 0) + 1);
    outgoing.get(value.source)!.push(value.target);
  }
  const queue = nodes
    .filter((item) => indegree.get(item.id) === 0)
    .map((item) => item.id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift()!;
    visited += 1;
    for (const target of outgoing.get(current)!) {
      const next = indegree.get(target)! - 1;
      indegree.set(target, next);
      if (next === 0) queue.push(target);
    }
  }
  if (visited !== nodes.length)
    invalid("dependencies must form a directed acyclic graph.");
  return { schemaVersion: 1, name, nodes, edges };
}

export function parseWorkflowDefinition(
  source: string,
  format: WorkflowDefinitionFormat,
): WorkflowDefinition {
  if (typeof source !== "string" || source.length > MAX_SOURCE_SIZE)
    invalid("source must be a string under 1 MB.");
  let value: unknown;
  try {
    if (format === "json") value = JSON.parse(source);
    else if (format === "yaml") {
      const documents = YAML.parseAllDocuments(source, {
        version: "1.2",
        schema: "core",
        uniqueKeys: true,
        customTags: [],
      });
      if (documents.length !== 1)
        invalid("YAML must contain exactly one document.");
      const document = documents[0];
      if (document.errors.length || document.warnings.length)
        invalid(
          document.errors[0]?.message ||
            document.warnings[0]?.message ||
            "unsafe YAML.",
        );
      value = document.toJS({ maxAliasCount: 0 });
    } else invalid("format must be json or yaml.");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid workflow definition:")
    )
      throw error;
    invalid(
      error instanceof Error ? error.message : "source could not be parsed.",
    );
  }
  return validateWorkflowDefinition(value);
}

export function serializeWorkflowDefinition(
  definition: WorkflowDefinition,
  format: WorkflowDefinitionFormat,
): string {
  const normalized = validateWorkflowDefinition(definition);
  if (format === "json") return `${JSON.stringify(normalized, null, 2)}\n`;
  if (format === "yaml") return YAML.stringify(normalized, { version: "1.2" });
  invalid("format must be json or yaml.");
}

/** Convert visual workflow data to a portable definition, dropping runtime-only fields. */
export function toWorkflowDefinition(input: {
  name: string;
  nodes: WorkflowNode[];
  edges: Dependency[];
}): WorkflowDefinition {
  const nodes = input.nodes.map((item, index) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    ownerId: item.ownerId,
    entity: item.entity,
    instructions: item.instructions,
    dueOffset: item.dueOffset,
    duration: item.duration,
    evidenceRequired: item.evidenceRequired,
    ...(item.approverId ? { approverId: item.approverId } : {}),
    statement: item.statement,
    position: item.position ?? {
      x: (index % 3) * 260,
      y: Math.floor(index / 3) * 150,
    },
    ...(item.packageId ? { packageId: item.packageId } : {}),
    ...(item.documentVersionId
      ? { documentVersionId: item.documentVersionId }
      : {}),
  }));
  return validateWorkflowDefinition({
    schemaVersion: 1,
    name: input.name,
    nodes,
    edges: input.edges,
  });
}
