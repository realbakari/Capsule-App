import { describe, expect, it } from "vitest";

import { toWorkspaceRelative } from "./paths";

const root = "/Users/me/Code/capsule";

describe("toWorkspaceRelative", () => {
  it("takes an absolute path inside the workspace", () => {
    expect(toWorkspaceRelative(`${root}/src/app.ts`, root)).toBe("src/app.ts");
  });

  it("drops a line suffix from a stack trace", () => {
    expect(toWorkspaceRelative(`${root}/src/app.ts:42:7`, root)).toBe("src/app.ts");
  });

  it("drops the workspace's own name when the agent included it", () => {
    expect(toWorkspaceRelative("capsule/src/app.ts", root)).toBe("src/app.ts");
  });

  it("leaves a path that is already relative", () => {
    expect(toWorkspaceRelative("./src/app.ts", root)).toBe("src/app.ts");
    expect(toWorkspaceRelative("src/app.ts", root)).toBe("src/app.ts");
  });

  it("names the root itself", () => {
    expect(toWorkspaceRelative(root, root)).toBe(".");
  });

  it("works without a workspace", () => {
    expect(toWorkspaceRelative("./src/app.ts", undefined)).toBe("src/app.ts");
  });
});
