import type { CapsuleApi } from "../../../../preload/index";
import { DEFAULT_CAPSULE_SETTINGS, PRESET_HARNESSES, summarizeRun } from "@capsule/shared";

/*
 * A read-only stand-in for the Electron preload bridge, used only on the web
 * URL. It lets the landing page mount the real application shell with a
 * representative conversation instead of describing the app in prose.
 *
 * Writes are unavailable and reads return explicitly shaped sample data: nothing here
 * reaches a gateway, a filesystem, or a database.
 */
const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const PROJECT = {
  id: "demo-project",
  workspaceId: "local",
  name: "capsule",
  workingDirectory: "/Users/you/code/capsule",
  defaultAgentId: "claude",
  defaultMode: "code" as const,
  defaultSkillIds: [],
  createdAt: at(600),
  updatedAt: at(3),
};

const SESSION = {
  id: "demo-session",
  workspaceId: "local",
  projectId: PROJECT.id,
  agentId: "claude",
  title: "Tidy the sidebar row layout",
  mode: "code" as const,
  state: "active" as const,
  harnessId: "claude",
  harnessState: "waiting",
  openclawSessionKey: "agent:claude:acp:demo",
  createdAt: at(30),
  updatedAt: at(3),
};

const MESSAGES = [
  {
    id: "demo-1",
    sessionId: SESSION.id,
    role: "user" as const,
    content: "The sidebar truncates thread titles too early. Can you look at why?",
    createdAt: at(9),
  },
  {
    id: "demo-2",
    sessionId: SESSION.id,
    role: "assistant" as const,
    content:
      "Two columns were reserved on every row and shown on almost none — a fixed pin slot and the row menu, which is `opacity: 0` until hover. Together they took about 45px of a 264px sidebar.\n\n```css\n.thread-row {\n  grid-template-columns: 2.15rem auto minmax(0, 1fr) auto;\n}\n```\n\nThe pin column now collapses when empty and the menu is positioned out of flow, so titles get the width back.",
    createdAt: at(7),
  },
];

const RUN = {
  id: "demo-run",
  sessionId: SESSION.id,
  projectId: PROJECT.id,
  agentId: "claude",
  status: "completed" as const,
  prompt: MESSAGES[0]!.content,
  createdAt: at(9),
  updatedAt: at(7),
  completedAt: at(7),
  result: MESSAGES[1]!.content,
};

const EVENTS = [
  { id: "d1", runId: RUN.id, timestamp: at(9), type: "thinking", message: "Measuring the row against the sidebar width", data: { streamKind: "thinking" } },
  { id: "d2", runId: RUN.id, timestamp: at(8), type: "tool", message: "read_file styles.css", data: { streamKind: "tool" } },
  { id: "d3", runId: RUN.id, timestamp: at(8), type: "tool", message: "read_file Sidebar.tsx", data: { streamKind: "tool" } },
  { id: "d4", runId: RUN.id, timestamp: at(7), type: "patch", message: "edit styles.css", data: { streamKind: "patch" } },
];

const GIT = {
  available: true,
  isRepo: true,
  branch: "main",
  dirty: true,
  changed: 1,
  summary: "main · 1 changed",
  branches: ["main"],
  added: 12,
  removed: 5,
  files: [{ path: "apps/desktop/src/renderer/src/styles.css", code: "M", added: 12, removed: 5 }],
};

const STATUS = {
  state: "connected" as const,
  kind: "openclaw" as const,
  gatewayUrl: "ws://127.0.0.1:18789",
  gatewayHost: "127.0.0.1",
  gatewayPort: 18789,
  agentCount: 1,
  sessionCount: 1,
  activeRunCount: 0,
};

/** Missing capabilities fail explicitly; an empty array is not a valid status. */
export function createDemoBridge(): CapsuleApi {
  const ok = <T,>(value: T) => Promise.resolve(value);
  const api: Record<string, unknown> = {
    isDesktop: false,
    homeDir: "/Users/you",
    on: () => () => undefined,
    windowBackground: () => ok(undefined),
    rendererReady: () => ok(undefined),
    isFullscreen: () => ok(false),
    getStatus: () => ok(STATUS),
    runtimeStatus: () => ok(STATUS),
    getSubsystemStatus: () =>
      ok({
        capsuleCore: "connected",
        openclawGateway: "connected",
        buzz: "disconnected",
        database: "connected",
        keychain: "connected",
      }),
    listProjects: () => ok([PROJECT]),
    listSessions: () => ok([SESSION]),
    listHarnessSessions: () => ok([SESSION]),
    listMessages: () => ok(MESSAGES),
    listMessagePage: () => ok({ messages: MESSAGES, hasMore: false }),
    listRuns: () => ok([RUN]),
    getRun: (id: string) => ok(id === RUN.id ? RUN : undefined),
    listLatestRuns: () => ok([summarizeRun(RUN)]),
    listRunPage: () => ok({ runs: [summarizeRun(RUN)], hasMore: false }),
    listRunEvents: () => ok(EVENTS),
    listRunEventPage: () => ok({ events: EVENTS, hasMore: false }),
    listAgents: () => ok([{ id: "claude", name: "Claude Code" }]),
    listHarnesses: () => ok(PRESET_HARNESSES.filter((item) => item.id === "claude").map((preset) => ({
      ...preset, installed: true, readiness: "ready", runtimeRoute: "gateway", detail: "Sample workspace",
    }))),
    harnessStatus: () => ok({ session: { id: SESSION.id, projectId: PROJECT.id }, harnessId: "claude",
      openclawSessionKey: SESSION.openclawSessionKey, state: "waiting", parsed: {} }),
    listSkills: () => ok([]),
    listSkillPacks: () => ok([]),
    listArtifacts: () => ok([]),
    listApprovals: () => ok([]),
    listProjectActionRuns: () => ok([]),
    listTerminalSessions: () => ok([]),
    listFiles: () => ok([]),
    listLocalServers: () => ok([]),
    contextUsage: () => ok(undefined),
    gitStatus: () => ok(GIT),
    gitDiff: () => ok(""),
    getSettings: () => ok({ ...DEFAULT_CAPSULE_SETTINGS, appearanceTheme: "dark" }),
  };
  return new Proxy(api, {
    get: (target, key) => {
      if (key in target) return target[key as string];
      if (typeof key !== "string" || key === "then") return undefined;
      return () => Promise.reject(new Error("This is a sample workspace. Open the desktop app to use this action."));
    },
  }) as unknown as CapsuleApi;
}
