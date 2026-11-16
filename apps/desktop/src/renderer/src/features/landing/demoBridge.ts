import type { CapsuleApi } from "../../../../preload/index";
import { DEFAULT_CAPSULE_SETTINGS, PRESET_HARNESSES, summarizeRun } from "@capsule/shared";
import { RELEASE } from "./site-content";

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
      "Two columns were reserved on every row and used on almost none: a fixed pin slot, and the row menu, which stays `opacity: 0` until hover. Together they took about 45px of a 264px sidebar.\n\nThe pin column now collapses when it is empty and the menu sits outside the row's grid, so titles get that width back. `pnpm test` passes.",
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

/*
 * Tool steps as an agent reports them: one call per id, finished. Without a
 * status the transcript would honestly say the completion was not reported,
 * which is right for a live agent and wrong for a finished sample.
 */
const step = (id: string, minutes: number, kind: string, title: string, stream = "tool") => ({
  id, runId: RUN.id, timestamp: at(minutes), type: stream, message: title,
  data: { streamKind: stream, toolCallId: id, kind, title, status: "completed" },
});
const EVENTS = [
  { id: "d0", runId: RUN.id, timestamp: at(9), type: "thinking", message: "Measuring the row against the sidebar width", data: { streamKind: "thinking" } },
  step("d1", 9, "read", "Read styles.css"),
  step("d2", 8, "read", "Read Sidebar.tsx"),
  step("d3", 8, "edit", "Edit styles.css", "patch"),
  step("d4", 7, "execute", "pnpm test"),
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

const DIFF = `diff --git a/apps/desktop/src/renderer/src/styles.css b/apps/desktop/src/renderer/src/styles.css
--- a/apps/desktop/src/renderer/src/styles.css
+++ b/apps/desktop/src/renderer/src/styles.css
@@ -184,7 +184,6 @@ .thread-row {
   display: grid;
-  grid-template-columns: 2.15rem auto minmax(0, 1fr) auto;
+  grid-template-columns: auto minmax(0, 1fr);
+  column-gap: 0.5rem;
   align-items: center;
`;

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
    /* Not a paired device: no remote banner, and the composer stays read-only. */
    remoteMode: undefined,
    /* The sample is the macOS app, the build most people download. */
    platform: "darwin",
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
    providerUsage: () => ok({ reports: [], truncated: false }),
    listRunPage: () => ok({ runs: [summarizeRun(RUN)], hasMore: false }),
    listRunEvents: () => ok(EVENTS),
    listRunEventPage: () => ok({ events: EVENTS, hasMore: false }),
    listAgents: () => ok([{ id: "claude", name: "Claude Code" }]),
    listHarnesses: () => ok(PRESET_HARNESSES.filter((item) => item.id === "claude").map((preset) => ({
      ...preset, installed: true, readiness: "ready", runtimeRoute: "gateway", detail: "Sample workspace",
    }))),
    harnessStatus: () => ok({ session: { id: SESSION.id, projectId: PROJECT.id }, harnessId: "claude",
      openclawSessionKey: SESSION.openclawSessionKey, state: "waiting", parsed: {} }),
    listThreadGroups: () => ok([]),
    getFollowUps: () => ok({ queue: [] }),
    commandsList: () => ok({ commands: [], problems: [], sources: {} }),
    forkBranches: () => ok([]),
    runRatings: () => ok({}),
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
    gitDiff: () => ok(DIFF),
    getSettings: () => ok({ ...DEFAULT_CAPSULE_SETTINGS, appearanceTheme: "dark" }),
    // There is nothing to update in a sample, and saying so must not surface as an error.
    updateStatus: () => ok({ state: "unknown", current: RELEASE }),
  };
  return new Proxy(api, {
    get: (target, key) => {
      if (key in target) return target[key as string];
      if (typeof key !== "string" || key === "then") return undefined;
      return () => Promise.reject(new Error("This is a sample workspace. Open the desktop app to use this action."));
    },
  }) as unknown as CapsuleApi;
}
