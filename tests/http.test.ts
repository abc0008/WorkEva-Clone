import { describe, it, expect } from "vitest";
import { sameOrigin } from "@/server/http";
describe("request origin boundary", () => {
  it("allows browser host when Next normalizes its internal URL", () => {
    expect(() =>
      sameOrigin(
        new Request("http://localhost:3000/api/commands", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow();
  });
  it("rejects foreign origin and cross-site requests", () => {
    expect(() =>
      sameOrigin(
        new Request("https://workeva.example/api/commands", {
          headers: { host: "workeva.example", origin: "https://evil.example" },
        }),
      ),
    ).toThrow("Cross-origin");
    expect(() =>
      sameOrigin(
        new Request("https://workeva.example/api/commands", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toThrow("Cross-origin");
  });
});
