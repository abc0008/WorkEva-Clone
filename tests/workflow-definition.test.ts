import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseWorkflowDefinition,
  validateWorkflowDefinition,
  serializeWorkflowDefinition,
  toWorkflowDefinition,
} from "@/lib/workflow-definition";
import { seedState } from "@/lib/seed";
import { handleWorkflowCommand } from "@/server/workflow";

const definition = () => ({
  schemaVersion: 1,
  name: "Quarterly certification",
  nodes: ["prepare", "certify"].map((id, i) => ({
    id,
    title: id,
    type: i ? "attestation" : "task",
    ownerId: "publisher",
    entity: "BANK",
    instructions: "Check supporting evidence.",
    dueOffset: i + 1,
    duration: 1,
    evidenceRequired: false,
    statement: "I confirm this work is complete.",
    position: { x: i * 300, y: 80 },
  })),
  edges: [
    {
      id: "prepare-certify",
      source: "prepare",
      target: "certify",
      hard: true,
      lag: 1,
    },
  ],
});

describe("portable workflow definition", () => {
  it("ships equivalent valid JSON and YAML examples", () => {
    const json = readFileSync("examples/quarterly-certification.json", "utf8");
    const yaml = readFileSync("examples/quarterly-certification.yaml", "utf8");
    expect(parseWorkflowDefinition(yaml, "yaml")).toEqual(
      parseWorkflowDefinition(json, "json"),
    );
  });
  it("bounds input size and rejects YAML aliases", () => {
    expect(() =>
      parseWorkflowDefinition(" ".repeat(1_000_001), "json"),
    ).toThrow();
    const source = serializeWorkflowDefinition(
      validateWorkflowDefinition(definition()),
      "yaml",
    );
    expect(() =>
      parseWorkflowDefinition(
        source.replace(
          "name: Quarterly certification",
          "name: &name Quarterly certification",
        ) + "unknown: *name\n",
        "yaml",
      ),
    ).toThrow();
  });
  it("preserves graph semantics and layout across JSON and YAML", () => {
    const original = validateWorkflowDefinition(definition());
    const yaml = serializeWorkflowDefinition(original, "yaml");
    const json = serializeWorkflowDefinition(
      parseWorkflowDefinition(yaml, "yaml"),
      "json",
    );
    expect(parseWorkflowDefinition(json, "json")).toEqual(original);
  });
  it("assigns stable finite positions when authored without layout", () => {
    const input: any = definition();
    input.nodes.forEach((n: any) => delete n.position);
    const result = validateWorkflowDefinition(input);
    expect(validateWorkflowDefinition(input)).toEqual(result);
    for (const n of result.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });
  it("allows empty work instructions used by existing visual drafts", () => {
    const input = definition();
    input.nodes[0].instructions = "";
    expect(validateWorkflowDefinition(input).nodes[0].instructions).toBe("");
  });
  it.each([
    [
      "future version",
      (d: any) => {
        d.schemaVersion = 2;
      },
    ],
    [
      "runtime state",
      (d: any) => {
        d.nodes[0].signatureId = "forged";
      },
    ],
    [
      "template identity",
      (d: any) => {
        d.id = "published-id";
      },
    ],
    [
      "duplicate nodes",
      (d: any) => {
        d.nodes.push(d.nodes[0]);
      },
    ],
    [
      "duplicate edges",
      (d: any) => {
        d.edges.push(d.edges[0]);
      },
    ],
    [
      "dangling edge",
      (d: any) => {
        d.edges[0].target = "missing";
      },
    ],
    [
      "self link",
      (d: any) => {
        d.edges[0].target = "prepare";
      },
    ],
    [
      "cycle",
      (d: any) => {
        d.edges.push({
          id: "back",
          source: "certify",
          target: "prepare",
          hard: false,
          lag: 0,
        });
      },
    ],
    [
      "negative lag",
      (d: any) => {
        d.edges[0].lag = -1;
      },
    ],
    [
      "fractional timing",
      (d: any) => {
        d.nodes[0].duration = 0.5;
      },
    ],
    [
      "edge as endpoint",
      (d: any) => {
        d.edges.push({
          id: "invalid",
          source: "prepare-certify",
          target: "certify",
          hard: true,
          lag: 0,
        });
      },
    ],
    [
      "nonfinite position",
      (d: any) => {
        d.nodes[0].position.x = Infinity;
      },
    ],
    [
      "unknown node type",
      (d: any) => {
        d.nodes[0].type = "execute_code";
      },
    ],
    [
      "coerced boolean",
      (d: any) => {
        d.edges[0].hard = "false";
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const input = definition();
    mutate(input);
    expect(() => validateWorkflowDefinition(input)).toThrow();
  });
  it.each([
    "schemaVersion: 1\nschemaVersion: 1\nname: Duplicate",
    "---\nname: First\n---\nname: Second",
    "name: !execute payload",
    "name: [unterminated",
  ])("rejects invalid YAML without executing tags", (source) => {
    expect(() => parseWorkflowDefinition(source, "yaml")).toThrow();
  });
  it("exports template content without identity or publication metadata", () => {
    const template = seedState().templates[0];
    const result = toWorkflowDefinition(template);
    expect(Object.keys(result).sort()).toEqual([
      "edges",
      "name",
      "nodes",
      "schemaVersion",
    ]);
    expect(result.nodes).toEqual(template.nodes);
  });
  it("persists a definition as a fresh draft while preserving a published template", () => {
    const state = seedState();
    const actor = state.users.find((u) => u.id === "publisher")!;
    state.templates[0].status = "PUBLISHED";
    const before = structuredClone(state.templates[0]);
    const result: any = handleWorkflowCommand(state, actor, {
      type: "saveTemplate",
      definition: definition(),
    });
    expect(result.status).toBe("DRAFT");
    expect(result.id).not.toBe(before.id);
    expect(result.nodes).toEqual(definition().nodes);
    expect(state.templates[0]).toEqual(before);
    expect(() =>
      handleWorkflowCommand(state, actor, {
        type: "saveTemplate",
        templateId: before.id,
        expectedRevision: before.revision,
        definition: definition(),
      }),
    ).toThrow();
  });
  it("still enforces owner and entity authorization on imported definitions", () => {
    const state = seedState();
    const actor = state.users.find((u) => u.id === "publisher")!;
    const input = definition();
    input.nodes[0].ownerId = "unknown-user";
    expect(() =>
      handleWorkflowCommand(state, actor, {
        type: "saveTemplate",
        definition: input,
      }),
    ).toThrow();
    input.nodes[0].ownerId = "publisher";
    const scoped = { ...actor, entities: ["AL"] };
    expect(() =>
      handleWorkflowCommand(state, scoped, {
        type: "saveTemplate",
        definition: input,
      }),
    ).toThrow();
  });
});
