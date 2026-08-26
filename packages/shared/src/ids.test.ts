import { describe, expect, it } from "vitest";
import { createId, nowIso } from "./ids.js";

describe("createId", () => {
  it("uses web crypto and never imports node:crypto", () => {
    const id = createId("msg");
    expect(id.startsWith("msg_")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
    expect(createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns an ISO timestamp", () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
