import { describe, expect, it } from "vitest";
import { decidePolicy, DEFAULT_POLICIES, isDestructivePath, policiesFromSettings } from "./index.js";

describe("policies", () => {
  it("requires approval for filesystem writes", () => {
    expect(decidePolicy(DEFAULT_POLICIES, "filesystem", "write").decision).toBe("approval");
  });

  it("blocks filesystem deletes", () => {
    expect(decidePolicy(DEFAULT_POLICIES, "filesystem", "delete").decision).toBe("block");
  });

  it("flags key material as destructive", () => {
    expect(isDestructivePath("/Users/dev/.ssh/id_ed25519")).toBe(true);
    expect(isDestructivePath("/Users/dev/Projects/app/src/index.ts")).toBe(false);
  });

  it("maps sandbox and web settings onto policy rules", () => {
    const strict = policiesFromSettings({ webAccess: "off", sandbox: "strict" });
    expect(strict.find((rule) => rule.id === "net-https")?.decision).toBe("block");
    expect(strict.find((rule) => rule.id === "term-exec")?.decision).toBe("block");
    const open = policiesFromSettings({ webAccess: "on", sandbox: "off" });
    expect(open.find((rule) => rule.id === "net-https")?.decision).toBe("allow");
    expect(open.find((rule) => rule.id === "term-exec")?.decision).toBe("allow");
  });
});
