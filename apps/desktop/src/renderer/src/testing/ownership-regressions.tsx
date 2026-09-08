import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type Session } from "@capsule/shared";
import { WorkspaceProvider, useWorkspace } from "../lib/workspace.js";
import { VirtualTurns } from "../features/conversation/VirtualTurns";
import type { Turn } from "../lib/turns";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(check: () => unknown, detail = "state update") {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Ownership regression timed out: ${detail}; rows=${Array.from(document.querySelectorAll<HTMLElement>("[data-virtual-turn]")).map((row) => row.dataset.virtualTurn).join(",")}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Real provider state, including the async boundary before the first send. */
async function firstSend(host: HTMLElement, fail: boolean | "creation") {
  const original = window.capsule;
  const originalSetItem = Storage.prototype.setItem;
  let state!: ReturnType<typeof useWorkspace>;
  function Capture() { state = useWorkspace(); return null; }
  const sessions: Session[] = [];
  let create!: () => void;
  let finish!: () => void;
  localStorage.clear();
  window.capsule = {
    ...original,
    listProjects: async () => [{ id: "ownership-project", name: "Fixture" }],
    listAgents: async () => [{ id: "general", name: "Fixture" }], listSkills: async () => [], listSkillPacks: async () => [],
    getStatus: async () => ({ kind: "openclaw", state: "connected" }), getSubsystemStatus: async () => ({}),
    listApprovals: async () => [], listHarnesses: async () => [], listHarnessSessions: async () => [],
    getSettings: async () => ({ ...DEFAULT_CAPSULE_SETTINGS, defaultMode: "chat", defaultAgentId: "general" }),
    listSessions: async () => sessions, listLatestRuns: async () => [], listRunPage: async () => ({ runs: [], hasMore: false }),
    listMessagePage: async () => ({ messages: [], hasMore: false }), gitStatus: async () => ({ isRepo: false }), listFiles: async () => [],
    on: () => () => {},
    createSession: async (input: Partial<Session>) => {
      await new Promise<void>((resolve) => { create = resolve; });
      if (fail === "creation") throw new Error("Thread creation rejected");
      const session = { ...input, id: "created-thread", state: "active" } as Session;
      sessions.push(session);
      return session;
    },
    sendMessage: async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      if (fail) throw new Error("Rejected fixture");
    },
  } as unknown as typeof original;
  const root = createRoot(host);
  try {
    root.render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    await until(() => state?.ready);
    state.setDraft("submitted work");
    await until(() => state.draft === "submitted work");
    const pending = state.send();
    await until(() => create);
    state.setDraft("follow-up while creating");
    state.setSkillId("follow-up-skill");
    await until(() => state.skillId === "follow-up-skill");
    if (fail) Storage.prototype.setItem = () => { throw new Error("Storage unavailable"); };
    create();
    if (fail !== "creation") {
      await until(() => finish);
      finish();
    }
    await pending;
    await until(() => !state.busy);
    assert(state.draft === "follow-up while creating" && state.skillId === "follow-up-skill", "First-send creation cleared the newer draft or skill");
    if (fail) {
      assert(state.promptStashes.some((entry) => entry.prompt === "submitted work" && entry.temporary), "Failed storage lost the submitted prompt");
      assert(state.notice?.includes("temporarily") && !state.notice.includes("saved in Stash"), "Failed storage claimed durable recovery");
    } else {
      await until(() => state.sessionId === "created-thread");
      assert(state.draft === "follow-up while creating", "New-thread navigation lost the follow-up draft");
    }
  } finally {
    root.unmount();
    Storage.prototype.setItem = originalSetItem;
    window.capsule = original;
  }
}

function LongTranscript({ turns }: { turns: Turn[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  return <div ref={scroller} data-scroll-fixture style={{ height: 400, overflow: "auto" }}>
    <VirtualTurns turns={turns} folded={new Set(turns.map((turn) => turn.id))} scroller={scroller} stick={false}>
      {(turn) => <div style={{ height: 68 }}>{turn.id}</div>}
    </VirtualTurns>
  </div>;
}

export async function runOwnershipRegressions(host: HTMLElement) {
  await firstSend(host, false);
  await firstSend(host, true);
  await firstSend(host, "creation");
  const root = createRoot(host);
  const turns = Array.from({ length: 1000 }, (_, index) => ({ id: `turn-${index}`, messages: [] }));
  try {
    root.render(<LongTranscript turns={turns} />);
    await until(() => host.querySelectorAll("[data-virtual-turn]").length > 0);
    assert(host.querySelectorAll("[data-virtual-turn]").length < 60, "Long transcript mounted every turn");
    const scroller = host.querySelector<HTMLElement>("[data-scroll-fixture]")!;
    scroller.scrollTop = 34000;
    scroller.dispatchEvent(new Event("scroll"));
    await until(() => host.querySelector('[data-virtual-turn="turn-500"]'), "middle transcript viewport");
    const before = host.querySelector('[data-virtual-turn="turn-500"]')!.getBoundingClientRect().top;
    root.render(<LongTranscript turns={[{ id: "prepended", messages: [] }, ...turns]} />);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = host.querySelector('[data-virtual-turn="turn-500"]')!.getBoundingClientRect().top;
    assert(Math.abs(before - after) < 2, "Prepending history moved the reading anchor");
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event("scroll"));
    await until(() => host.querySelector('[data-virtual-turn="turn-999"]'), "last transcript viewport");
    assert(host.querySelectorAll("[data-virtual-turn]").length < 60, "Scrolling leaked mounted rows");
  } finally { root.unmount(); }
}
