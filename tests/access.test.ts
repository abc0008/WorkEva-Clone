import { describe, it, expect } from "vitest";
import { seedState } from "@/lib/seed";
import {
  canReadVersion,
  canReadEvidence,
  scopedSnapshot,
  exportPackage,
} from "@/server/access";
describe("scoped read boundaries", () => {
  it("allows an assigned reviewer to read the pilot PDF without disclosing another reviewer responses", () => {
    const s = seedState(),
      u = s.users[0];
    expect(canReadVersion(s, u, "blr-v1")).toBe(true);
    expect(canReadEvidence(s, u, s.evidence[0])).toBe(true);
    const visible = scopedSnapshot(s, u, false);
    expect(visible.assignments.map((a) => a.id)).toEqual(["review-al"]);
    expect(visible.users.map((u) => u.id)).toEqual(["avery"]);
    expect(visible.idempotency).toEqual([]);
  });
  it("denies unassigned user and full-package export by an ordinary reviewer", () => {
    const s = seedState(),
      u = { ...s.users[0], id: "unassigned" };
    expect(canReadVersion(s, u, "blr-v1")).toBe(false);
    expect(() => exportPackage(s, s.users[0], "blr-aug")).toThrow(
      "management access",
    );
  });
  it("does not expose draft PDFs in an unrelated reporting scope to administrators", () => {
    const s = seedState(),
      u = { ...s.users[3], entities: ["TN"] };
    expect(canReadVersion(s, u, "blr-v1")).toBe(false);
    expect(scopedSnapshot(s, u, false).packages).toHaveLength(0);
  });
});
