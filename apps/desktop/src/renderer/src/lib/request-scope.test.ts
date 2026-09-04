import { describe, expect, it } from "vitest";
import { RequestScope } from "./request-scope";

describe("workspace response ownership", () => {
  it("rejects responses after switching away and back", () => {
    const scope = new RequestScope(); scope.select("project/thread/a"); const old = scope.capture("git");
    scope.select("project/thread/b"); scope.select("project/thread/a"); expect(old()).toBe(false);
  });
  it("invalidates a read when a newer read or mutation starts", () => {
    const scope = new RequestScope(); scope.select("a"); const read = scope.capture("git"); const mutation = scope.capture("git");
    expect(read()).toBe(false); expect(mutation()).toBe(true);
  });
  it("keeps resource versions separate and rejects old page loads on cwd changes", () => {
    const scope = new RequestScope(); scope.select("a/one"); const page = scope.capture("messages"); scope.capture("git"); expect(page()).toBe(true);
    scope.select("a/two"); expect(page()).toBe(false);
  });
});
