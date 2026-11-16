import type { CapsuleApi } from "../../../../preload/index";
import {
  DEFAULT_CAPSULE_SETTINGS, PRESET_HARNESSES, summarizeRun,
  type ChatMessage, type GitChange, type GitPullRequest, type GitStatus, type HarnessId, type Project, type Run, type RunEvent,
  type RunHistoryQuery, type Session,
} from "@capsule/shared";
import { RELEASE } from "./site-content";

/*
 * A read-only stand-in for the Electron preload bridge, used only on the web
 * URL. It lets the landing page mount the real application shell with a
 * representative workspace instead of describing the app in prose.
 *
 * Writes are unavailable and reads return explicitly shaped sample data: nothing here
 * reaches a gateway, a filesystem, or a database.
 */
const now = Date.now();
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

/** Everything one sample thread shows: the bridge reads nothing else. */
interface SampleConversation {
  project: Project;
  session: Session;
  messages: ChatMessage[];
  run: Run;
  events: RunEvent[];
  git: GitStatus;
  diff: string;
}

interface SampleStep { kind: "read" | "edit" | "execute"; title: string }

interface SampleInput {
  id: string;
  project: Project;
  harness: Extract<HarnessId, "claude" | "codex">;
  title: string;
  /** When the agent's reply landed. */
  minutesAgo: number;
  prompt: string;
  thinking: string;
  steps: SampleStep[];
  reply: string;
  /** A reply nobody has opened yet, marked in the sidebar. */
  unread?: boolean;
  branch?: string;
  changes?: { files: GitChange[]; diff: string };
}

const project = (id: string, description: string, minutesAgo: number): Project => ({
  id, workspaceId: "local", name: id, description,
  workingDirectory: `/Users/you/code/${id}`,
  defaultAgentId: "claude", defaultMode: "code", defaultSkillIds: [],
  createdAt: at(minutesAgo + 60 * 24 * 40), updatedAt: at(minutesAgo),
});

/*
 * One turn, laid out a minute per step between the prompt and the reply.
 * Each tool step is one finished call: without a status the transcript would
 * honestly say the completion was not reported, which is right for a live
 * agent and wrong for a finished sample.
 */
function conversation(input: SampleInput): SampleConversation {
  const started = input.minutesAgo + input.steps.length + 1;
  const runId = `${input.id}-run`;
  const session: Session = {
    id: input.id, workspaceId: "local", projectId: input.project.id,
    agentId: input.harness, harnessId: input.harness, harnessState: "waiting",
    openclawSessionKey: `agent:${input.harness}:acp:${input.id}`,
    title: input.title, mode: "code", state: "active",
    createdAt: at(started + 2), updatedAt: at(input.minutesAgo),
    lastViewedAt: input.unread ? undefined : at(Math.max(0, input.minutesAgo - 1)),
  };
  const messages: ChatMessage[] = [
    { id: `${input.id}-prompt`, sessionId: input.id, role: "user", content: input.prompt, runId, createdAt: at(started) },
    { id: `${input.id}-reply`, sessionId: input.id, role: "assistant", content: input.reply, runId, createdAt: at(input.minutesAgo) },
  ];
  const run: Run = {
    id: runId, sessionId: input.id, projectId: input.project.id, agentId: input.harness,
    status: "completed", prompt: input.prompt, result: input.reply,
    createdAt: at(started), updatedAt: at(input.minutesAgo), completedAt: at(input.minutesAgo),
  };
  const events: RunEvent[] = [
    { id: `${input.id}-thinking`, runId, timestamp: at(started), type: "thinking", message: input.thinking, data: { streamKind: "thinking" } },
    ...input.steps.map(({ kind, title }, index): RunEvent => {
      const id = `${input.id}-step-${index + 1}`;
      const stream = kind === "edit" ? "patch" : "tool";
      return {
        id, runId, timestamp: at(started - index - 1), type: stream, message: title,
        data: { streamKind: stream, toolCallId: id, kind, title, status: "completed" },
      };
    }),
  ];
  const branch = input.branch ?? "main";
  const files = input.changes?.files ?? [];
  const git: GitStatus = {
    available: true, isRepo: true, branch, branches: [...new Set(["main", branch])],
    dirty: files.length > 0, changed: files.length, files,
    summary: files.length > 0 ? `${branch} · ${files.length} changed` : `${branch} · clean`,
    added: files.reduce((sum, file) => sum + (file.added ?? 0), 0),
    removed: files.reduce((sum, file) => sum + (file.removed ?? 0), 0),
  };
  return { project: input.project, session, messages, run, events, git, diff: input.changes?.diff ?? "" };
}

const HARBOR = project("harbor-web", "Storefront web app", 120);
const LEDGER = project("ledger-api", "Payments service", 4);
const FIELDNOTES = project("fieldnotes-ios", "Note-taking app for iPhone", 50);

const RATE_LIMIT_DIFF = `diff --git a/src/middleware/rateLimit.ts b/src/middleware/rateLimit.ts
new file mode 100644
--- /dev/null
+++ b/src/middleware/rateLimit.ts
@@ -0,0 +1,20 @@
+import type { Handler } from "../http";
+
+/** A fixed window per account: limit requests every windowMs. */
+export function rateLimit({ limit, windowMs }: { limit: number; windowMs: number }): Handler {
+  const windows = new Map<string, { count: number; resetAt: number }>();
+  return (req, res, next) => {
+    const now = Date.now();
+    const window = windows.get(req.account.id);
+    if (!window || window.resetAt <= now) {
+      windows.set(req.account.id, { count: 1, resetAt: now + windowMs });
+      return next();
+    }
+    if (window.count >= limit) {
+      res.set("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)));
+      return res.status(429).json({ error: "rate_limited" });
+    }
+    window.count += 1;
+    next();
+  };
+}
diff --git a/src/routes/checkout.ts b/src/routes/checkout.ts
--- a/src/routes/checkout.ts
+++ b/src/routes/checkout.ts
@@ -1,10 +1,12 @@
 import { Router } from "../http";
 import { requireAccount } from "../middleware/auth";
+import { rateLimit } from "../middleware/rateLimit";
 import { createPaymentIntent } from "../payments";

 export const checkout = Router();
+const perAccount = rateLimit({ limit: 10, windowMs: 60_000 });

-checkout.post("/checkout", requireAccount, async (req, res) => {
+checkout.post("/checkout", requireAccount, perAccount, async (req, res) => {
   const intent = await createPaymentIntent(req.account, req.body.cart);
   res.status(201).json({ id: intent.id, status: intent.status });
 });
diff --git a/test/rateLimit.test.ts b/test/rateLimit.test.ts
new file mode 100644
--- /dev/null
+++ b/test/rateLimit.test.ts
@@ -0,0 +1,16 @@
+import { test } from "node:test";
+import assert from "node:assert/strict";
+import { client } from "./helpers";
+
+test("checkout accepts 10 requests a minute per account", async () => {
+  const account = client.as("acct_test_1");
+  for (let i = 0; i < 10; i++) assert.equal((await account.post("/checkout")).status, 201);
+});
+
+test("the 11th request gets a 429 with Retry-After", async () => {
+  const account = client.as("acct_test_2");
+  for (let i = 0; i < 10; i++) await account.post("/checkout");
+  const response = await account.post("/checkout");
+  assert.equal(response.status, 429);
+  assert.ok(Number(response.headers["retry-after"]) > 0);
+});
`;

/** Keyed by session id. The selected thread is the one the sample opens on. */
const CONVERSATIONS = new Map([
  conversation({
    id: "checkout-rate-limit", project: LEDGER, harness: "claude", minutesAgo: 4,
    title: "Add rate limiting to checkout",
    prompt: "Checkout has no rate limit, so one account can flood the payment queue. Add a per-account limit of 10 requests a minute, and answer with a 429 and a Retry-After header when it trips.",
    thinking: "Finding where checkout requests enter the service",
    steps: [
      { kind: "read", title: "Read src/routes/checkout.ts" },
      { kind: "read", title: "Read src/middleware/auth.ts" },
      { kind: "edit", title: "Create src/middleware/rateLimit.ts" },
      { kind: "edit", title: "Edit src/routes/checkout.ts" },
      { kind: "edit", title: "Create test/rateLimit.test.ts" },
      { kind: "execute", title: "pnpm test" },
    ],
    reply:
      "Checkout was only covered by the global limit in front of the API, so a single account could queue as many payment attempts as it liked. I added a fixed one-minute window per account in `rateLimit.ts` and mounted it on the checkout route only, after authentication, so the limit is keyed by the signed-in account rather than the IP.\n\nThe 11th request in a window now gets a 429 with a `Retry-After` header and never reaches the payment queue. Other routes are unchanged.\n\nThe suite passes: 148 tests, including two new ones for the limit and the header.",
    branch: "checkout-rate-limit",
    changes: {
      diff: RATE_LIMIT_DIFF,
      files: [
        { path: "src/middleware/rateLimit.ts", code: "A", added: 20, removed: 0 },
        { path: "src/routes/checkout.ts", code: "M", added: 3, removed: 1 },
        { path: "test/rateLimit.test.ts", code: "A", added: 16, removed: 0 },
      ],
    },
  }),
  conversation({
    id: "settings-dark-mode", project: FIELDNOTES, harness: "codex", minutesAgo: 50, unread: true,
    title: "Dark mode for the settings screen",
    prompt: "The settings screen ignores dark mode. Its rows stay white.",
    thinking: "Looking for fixed colors in the settings views",
    steps: [
      { kind: "read", title: "Read Fieldnotes/Settings/SettingsView.swift" },
      { kind: "edit", title: "Edit Fieldnotes/Settings/SettingsView.swift" },
      { kind: "execute", title: "make test" },
    ],
    reply: "The rows used fixed white and black. They now use the system background and label colors, so they follow the appearance setting, and the preview shows both modes.\n\nThe settings UI tests pass.",
  }),
  conversation({
    id: "order-history-pages", project: HARBOR, harness: "codex", minutesAgo: 120,
    title: "Paginate the order history",
    prompt: "The order history page loads every order at once and takes seconds for older accounts. Show 20 at a time.",
    thinking: "Checking what the orders endpoint already supports",
    steps: [
      { kind: "read", title: "Read src/pages/OrderHistory.tsx" },
      { kind: "edit", title: "Edit src/pages/OrderHistory.tsx" },
      { kind: "execute", title: "pnpm test" },
    ],
    reply: "The page now asks for 20 orders at a time and a Load more button fetches the next page. The endpoint already took a `cursor`, so this was a front-end change only.\n\nTests pass.",
  }),
  conversation({
    id: "timezone-flake", project: LEDGER, harness: "codex", minutesAgo: 60 * 26,
    title: "Fix the flaky timezone test",
    prompt: "settlement.test.ts fails about once a week in CI. I think it's a timezone thing.",
    thinking: "Reading how the test builds its expected dates",
    steps: [
      { kind: "read", title: "Read test/settlement.test.ts" },
      { kind: "edit", title: "Edit test/settlement.test.ts" },
      { kind: "execute", title: "pnpm test settlement --repeat 200" },
    ],
    reply: "It was. The test built its expected settlement date in the machine's local time, so it failed whenever it ran near midnight. It now pins the clock to a UTC instant and compares dates in UTC.\n\nThe file passed 200 runs in a row.",
  }),
  conversation({
    id: "react-19", project: HARBOR, harness: "claude", minutesAgo: 60 * 50,
    title: "Upgrade to React 19",
    prompt: "Upgrade the storefront to React 19 and fix whatever breaks.",
    thinking: "Listing the APIs the new major version removes",
    steps: [
      { kind: "read", title: "Read package.json" },
      { kind: "edit", title: "Edit package.json" },
      { kind: "edit", title: "Edit src/components/ProductGallery.tsx" },
      { kind: "execute", title: "pnpm build" },
      { kind: "execute", title: "pnpm test" },
    ],
    reply: "Upgraded. One component still used a string ref, which the new version removes, so it now uses `useRef`.\n\nThe build is clean and all tests pass.",
  }),
  conversation({
    id: "webhook-retries", project: LEDGER, harness: "claude", minutesAgo: 60 * 74,
    title: "Retry failed webhook deliveries",
    prompt: "When a merchant's webhook endpoint is down we drop the event. Retry it with backoff.",
    thinking: "Tracing what happens after a delivery fails",
    steps: [
      { kind: "read", title: "Read src/webhooks/deliver.ts" },
      { kind: "edit", title: "Edit src/webhooks/deliver.ts" },
      { kind: "execute", title: "pnpm test" },
    ],
    reply: "Failed deliveries now go back on the queue after 1 minute, then 5, 30 and 120, and are marked failed after the fifth attempt. Each attempt is logged with the response status.\n\nTests cover the schedule and the final failure, and they pass.",
  }),
].map((sample) => [sample.session.id, sample]));

const SELECTED = CONVERSATIONS.get("checkout-rate-limit")!;
/* The app opens the first project's first active thread, so the selected one leads. */
const SAMPLES = [SELECTED, ...[...CONVERSATIONS.values()].filter((sample) => sample !== SELECTED)];
const PROJECTS = [...new Set(SAMPLES.map((sample) => sample.project))];
const HARNESS_IDS = new Set(SAMPLES.map((sample) => sample.session.harnessId));
const HARNESSES = PRESET_HARNESSES.filter((preset) => HARNESS_IDS.has(preset.id));

/* Open pull requests per sample project, on a made-up repository. */
const pullRequest = (projectId: string, number: number, title: string, minutesAgo: number, extra: Partial<GitPullRequest> = {}): GitPullRequest => ({
  number, title, url: `https://github.com/example/${projectId}/pull/${number}`, isDraft: false, state: "OPEN",
  checks: "success", author: "sample-dev", createdAt: at(minutesAgo + 60 * 26), updatedAt: at(minutesAgo), ...extra,
});
const PULL_REQUESTS: Record<string, GitPullRequest[]> = {
  [LEDGER.id]: [
    pullRequest(LEDGER.id, 214, "Retry failed webhook deliveries with backoff", 60 * 20, { reviewDecision: "APPROVED", headRefName: "webhook-retries" }),
    pullRequest(LEDGER.id, 209, "Fix the flaky timezone test", 60 * 26, { checks: "failure", headRefName: "timezone-test" }),
  ],
  [HARBOR.id]: [
    pullRequest(HARBOR.id, 88, "Paginate the order history", 110, { isDraft: true, checks: "pending", headRefName: "order-history-pages" }),
  ],
  [FIELDNOTES.id]: [],
};

const bySession = (id?: string) => (id ? CONVERSATIONS.get(id) : undefined);
const byRun = (id: string) => SAMPLES.find((sample) => sample.run.id === id);
/* A git read without a thread reads the project's most recent one. */
const forGit = (projectId: string, sessionId?: string) =>
  bySession(sessionId) ?? SAMPLES.find((sample) => sample.project.id === projectId);
const runsFor = (query: RunHistoryQuery = {}) => SAMPLES
  .filter((sample) => (!query.sessionId || sample.session.id === query.sessionId) && (!query.projectId || sample.project.id === query.projectId))
  .map((sample) => sample.run);
/* One file's section of a multi-file patch, as git prints it for a single path. */
const patchFor = (diff: string, relative?: string) => !relative ? diff
  : diff.split(/(?=^diff --git )/m).filter((part) => part.startsWith(`diff --git a/${relative} `)).join("");

const STATUS = {
  state: "connected" as const,
  kind: "openclaw" as const,
  gatewayUrl: "ws://127.0.0.1:18789",
  gatewayHost: "127.0.0.1",
  gatewayPort: 18789,
  agentCount: HARNESSES.length,
  sessionCount: SAMPLES.length,
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
    listProjects: () => ok(PROJECTS),
    listSessions: (projectId?: string) => ok(SAMPLES.filter((sample) => !projectId || sample.project.id === projectId).map((sample) => sample.session)),
    listHarnessSessions: (projectId?: string) => ok(SAMPLES.filter((sample) => !projectId || sample.project.id === projectId).map((sample) => sample.session)),
    listMessages: (sessionId: string) => ok(bySession(sessionId)?.messages ?? []),
    listMessagePage: (sessionId: string) => ok({ messages: bySession(sessionId)?.messages ?? [], hasMore: false }),
    listRuns: (sessionId?: string) => ok(runsFor({ sessionId })),
    getRun: (id: string) => ok(byRun(id)?.run),
    listLatestRuns: () => ok(runsFor().map(summarizeRun)),
    providerUsage: () => ok({ reports: [], truncated: false }),
    listRunPage: (query?: RunHistoryQuery) => ok({ runs: query?.before ? [] : runsFor(query).map(summarizeRun), hasMore: false }),
    listRunEvents: (runId: string) => ok(byRun(runId)?.events ?? []),
    listRunEventPage: (runId: string) => ok({ events: byRun(runId)?.events ?? [], hasMore: false }),
    listAgents: () => ok(HARNESSES.map((preset) => ({ id: preset.id, name: preset.name }))),
    listHarnesses: () => ok(HARNESSES.map((preset) => ({
      ...preset, installed: true, readiness: "ready", runtimeRoute: "gateway", detail: "Sample workspace",
    }))),
    harnessStatus: (sessionId: string) => {
      const sample = bySession(sessionId);
      return ok(sample && { session: { id: sample.session.id, projectId: sample.project.id }, harnessId: sample.session.harnessId,
        openclawSessionKey: sample.session.openclawSessionKey, state: sample.session.harnessState, parsed: {} });
    },
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
    gitStatus: (projectId: string, sessionId?: string) => ok(forGit(projectId, sessionId)?.git),
    gitDiff: (projectId: string, relative?: string, sessionId?: string) => ok(patchFor(forGit(projectId, sessionId)?.diff ?? "", relative)),
    /* Nothing is staged in the sample: every change is unstaged and uncommitted. */
    gitScopedDiff: (projectId: string, scope: string, relative?: string, sessionId?: string) => {
      const sample = forGit(projectId, sessionId);
      const patch = scope === "staged" ? "" : patchFor(sample?.diff ?? "", relative);
      return ok(scope === "branch" ? { patch, base: "main" } : { patch });
    },
    /* Each sample turn made exactly the changes its thread still has uncommitted. */
    turnDiff: (runId: string, options?: { relative?: string; summaryOnly?: boolean }) => {
      const sample = byRun(runId);
      return ok({
        available: true,
        patch: options?.summaryOnly ? "" : patchFor(sample?.diff ?? "", options?.relative),
        files: (sample?.git.files ?? []).map(({ path, added, removed, code }) => ({ path, added, removed, status: code === "A" ? "added" : "modified" })),
      });
    },
    listPullRequests: (projectId: string) => ok({ items: PULL_REQUESTS[projectId] ?? [] }),
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
