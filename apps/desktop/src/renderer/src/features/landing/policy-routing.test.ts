import { describe, expect, it } from "vitest";

import { POLICY_PAGES } from "./policies.generated";
import { policyForPath } from "./PolicyPage";

describe("public policy pages", () => {
  it("publishes all three", () => {
    expect(POLICY_PAGES.map((page) => page.slug).sort()).toEqual([
      "privacy",
      "security",
      "terms",
    ]);
  });

  it("answers the URLs the footer links to", () => {
    // A policy nobody can link to is not published.
    expect(policyForPath("/privacy")?.slug).toBe("privacy");
    expect(policyForPath("/security")?.slug).toBe("security");
    expect(policyForPath("/terms")?.slug).toBe("terms");
    expect(policyForPath("/terms/")?.slug).toBe("terms");
    expect(policyForPath("/Privacy")?.slug).toBe("privacy");
  });

  it("leaves every other path to the app", () => {
    expect(policyForPath("/")).toBeUndefined();
    expect(policyForPath("/anything-else")).toBeUndefined();
  });

  it("carries the words from the Markdown, converted", () => {
    const privacy = POLICY_PAGES.find((page) => page.slug === "privacy")!;
    // Real content, not a stub, and no leftover markup.
    expect(privacy.html).toContain("no analytics, no telemetry");
    expect(privacy.html).toContain("<table>");
    expect(privacy.html).not.toMatch(/\*\*[A-Za-z]/);
    expect(privacy.html).not.toMatch(/^\s*#{1,6}\s/m);
  });

  it("keeps the security page's limits, which are the part worth reading", () => {
    const security = POLICY_PAGES.find((page) => page.slug === "security")!;
    expect(security.html).toContain("Prompt injection is real");
    expect(security.html).toContain("not a sandbox");
  });
});
