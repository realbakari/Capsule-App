import { describe, expect, it } from "vitest";
import type { Session } from "@capsule/shared";
import { adjacentSession } from "./session-cycle";

const session = (id: string, updatedAt: string, state = "active") => ({ id, updatedAt, state, projectId: "p", title: id }) as unknown as Session;
const list = [session("old", "2026-01-01"), session("new", "2026-03-01"), session("mid", "2026-02-01"), session("gone", "2026-04-01", "archived")];

describe("adjacent session", () => {
  it("walks by most recent activity and wraps", () => {
    expect(adjacentSession(list, "new", 1)?.id).toBe("mid");
    expect(adjacentSession(list, "old", 1)?.id).toBe("new");
    expect(adjacentSession(list, "new", -1)?.id).toBe("old");
  });
  it("skips archived conversations and starts at the latest", () => {
    expect(adjacentSession(list, undefined, 1)?.id).toBe("new");
    expect(adjacentSession([session("x", "2026-01-01", "archived")], undefined, 1)).toBeUndefined();
  });
});
