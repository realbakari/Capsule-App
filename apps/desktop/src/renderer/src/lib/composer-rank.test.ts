import { describe, expect, it } from "vitest";
import { composerMatchRank, MATCH_RANK, rankGrouped, rankMatches } from "./composer-rank";

describe("composer match ranking", () => {
  it("orders exact, prefix, word, substring, in-order letters, then description", () => {
    expect(composerMatchRank("plan", "/plan")).toBe(MATCH_RANK.exact);
    expect(composerMatchRank("pl", "/plan")).toBe(MATCH_RANK.prefix);
    expect(composerMatchRank("review", "/code-review")).toBe(MATCH_RANK.word);
    expect(composerMatchRank("view", "/code-review")).toBe(MATCH_RANK.substring);
    expect(composerMatchRank("cdrv", "/code-review")).toBe(MATCH_RANK.fuzzy);
    expect(composerMatchRank("conversation", "/new", "New conversation")).toBe(MATCH_RANK.description);
    expect(composerMatchRank("zzz", "/new", "New conversation")).toBeUndefined();
  });

  it("puts the exact name first even when it came last", () => {
    const names = ["/compact-history", "/recompact", "/compact"];
    expect(rankMatches(names, "compact", (name) => name)).toEqual(["/compact", "/compact-history", "/recompact"]);
  });

  it("keeps each group together and leads with the group holding the best match", () => {
    const items = [
      { label: "/deploy-init", group: "Commands" },
      { label: "/new", group: "Capsule" },
      { label: "/init", group: "Capsule" },
    ];
    expect(rankGrouped(items, "init", (item) => item.label).map((item) => item.label)).toEqual(["/init", "/deploy-init"]);
  });
});
