import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";

const openPr = { number: 1, url: "https://github.com/example/repo/pull/1", state: "OPEN" };
const remote = vi.hoisted(() => ({ poll: vi.fn(), merge: vi.fn(), enrich: vi.fn() }));
vi.mock("@capsule/filesystem", async (original) => ({
  ...await original<typeof import("@capsule/filesystem")>(),
  pollPullRequest: remote.poll,
  enrichGitStatus: async (status: object) => ({ ...status, ...(remote.enrich(status) ?? { pullRequest: { number: 1, url: "https://github.com/example/repo/pull/1", state: "OPEN" }, pullRequestKnown: true }) }),
  pushCurrentBranch: async () => ({ ok: true }),
  createPullRequest: async () => ({ ok: true, url: "https://github.com/example/repo/pull/1" }),
  mergePullRequest: remote.merge,
}));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); remote.poll.mockReset(); remote.merge.mockReset(); remote.enrich.mockReset(); });

async function setup(worktree = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-watch-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  git("init"); git("config", "user.email", "capsule@example.test"); git("config", "user.name", "Capsule Test");
  writeFileSync(path.join(directory, "README.md"), "initial\n");
  git("add", "README.md"); git("commit", "-m", "initial");
  const engine = new CapsuleEngine({ databasePath: ":memory:", userDataDir: directory, autoConnect: false });
  await engine.start();
  await engine.updateSettings({ prWatchAndFix: true, prAutoMerge: false, prReviewDelivery: "current" });
  const project = engine.createProject({ name: "Watch fixture", workingDirectory: directory });
  const session = await engine.createSession({ projectId: project.id, workspaceMode: worktree ? "worktree" : "local" });
  return { engine, project, session, async dispose() { await engine.stop(); rmSync(directory, { recursive: true, force: true }); } };
}

it("watches the thread's checkout and does not overlap a slow refresh", async () => {
  const fixture = await setup(true);
  let finish!: (value: { known: boolean }) => void;
  remote.poll.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await fixture.engine.gitCreatePullRequest(fixture.project.id, { sessionId: fixture.session.id });
    expect(remote.poll).toHaveBeenCalledWith(fixture.session.workingDirectory);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(remote.poll).toHaveBeenCalledTimes(1);
    finish({ known: false });
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(45_000);
    expect(remote.poll).toHaveBeenCalledTimes(2);
    finish({ known: false });
  } finally { await fixture.dispose(); }
});

it("Stop invalidates a pending watch and ordinary status refreshes do not wake it again", async () => {
  const fixture = await setup();
  let finish!: (value: unknown) => void;
  remote.poll.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  try {
    const turn = await fixture.engine.sendMessage({ sessionId: fixture.session.id, content: "Hello", mode: "chat" });
    await vi.waitFor(() => expect(fixture.engine.getRun(turn.run.id)?.completedAt).toBeTruthy(), { timeout: 5000 });
    await fixture.engine.gitCreatePullRequest(fixture.project.id, { sessionId: fixture.session.id });
    const send = vi.spyOn(fixture.engine, "sendMessage");
    await fixture.engine.stopRun(turn.run.id);
    finish({ known: true, value: { number: 1, url: "https://github.com/example/repo/pull/1", state: "OPEN", checks: "failure" } });
    await new Promise((resolve) => setImmediate(resolve));
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(send).not.toHaveBeenCalled();
    expect(remote.poll).toHaveBeenCalledTimes(1);
    expect(remote.merge).not.toHaveBeenCalled();
    // Deliberately creating another PR is a new watch, not an old timer revival.
    remote.poll.mockResolvedValue({ known: false });
    await fixture.engine.gitCreatePullRequest(fixture.project.id, { sessionId: fixture.session.id });
    expect(remote.poll).toHaveBeenCalledTimes(2);
  } finally { await fixture.dispose(); }
});

it("delivers repairs in a new chat without leaving the watched worktree", async () => {
  const fixture = await setup(true);
  try {
    await fixture.engine.updateSettings({ prReviewDelivery: "new-chat" });
    remote.poll.mockResolvedValue({ known: true, value: {
      number: 1, url: "https://github.com/example/repo/pull/1", state: "OPEN", checks: "failure", checksSummary: "tests failed",
    } });
    const send = vi.spyOn(fixture.engine, "sendMessage");
    await fixture.engine.gitCreatePullRequest(fixture.project.id, { sessionId: fixture.session.id });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const repair = fixture.engine.listSessions(fixture.project.id).find((session) => session.id !== fixture.session.id)!;
    expect(repair.workingDirectory).toBe(fixture.session.workingDirectory);
    expect(repair.workspaceMode).toBe("local");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ sessionId: repair.id }));
    await fixture.engine.deleteSession(fixture.session.id);
    expect(existsSync(repair.workingDirectory!)).toBe(true);
  } finally { await fixture.dispose(); }
});

it("keeps watching through an unknown reading and never re-sends the same fix after a restart", async () => {
  const fixture = await setup();
  try {
    remote.poll.mockResolvedValue({ known: true, value: { ...openPr, checks: "failure", checksSummary: "tests failed" } });
    const send = vi.spyOn(fixture.engine, "sendMessage");
    await fixture.engine.gitCreatePullRequest(fixture.project.id, { sessionId: fixture.session.id });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const watching = () => (fixture.engine as unknown as { prWatchers: Map<string, unknown> }).prWatchers.has(fixture.project.id);

    // An overlapping read: not known yet, so not "no pull request".
    remote.enrich.mockReturnValue({ pullRequest: undefined, pullRequestKnown: false });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(watching()).toBe(true);

    // A reading that landed with no PR stops it; the PR showing again restarts it.
    remote.enrich.mockReturnValue({ pullRequest: undefined, pullRequestKnown: true });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(watching()).toBe(false);
    remote.enrich.mockReturnValue({ pullRequest: openPr, pullRequestKnown: true });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    await vi.waitFor(() => expect(remote.poll.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).toHaveBeenCalledOnce();
  } finally { await fixture.dispose(); }
});

it("keeps the pull request a worktree thread's status read, for the sidebar", async () => {
  const fixture = await setup(true);
  const stored = () => fixture.engine.listSessions(fixture.project.id).find((item) => item.id === fixture.session.id)?.pullRequest;
  try {
    remote.enrich.mockReturnValue({ pullRequest: { number: 4, url: "https://github.com/example/repo/pull/4", state: "OPEN", isDraft: true, title: "x" }, pullRequestKnown: true });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(stored()).toMatchObject({ number: 4, isDraft: true });
    // A reading that did not land says nothing about the pull request.
    remote.enrich.mockReturnValue({ pullRequestKnown: false });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(stored()?.number).toBe(4);
    remote.enrich.mockReturnValue({ pullRequest: undefined, pullRequestKnown: true });
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(stored()).toBeUndefined();
  } finally { await fixture.dispose(); }
});

it("does not give a thread on the shared checkout the branch's pull request", async () => {
  const fixture = await setup(false);
  try {
    await fixture.engine.gitStatus(fixture.project.id, fixture.session.id);
    expect(fixture.engine.listSessions(fixture.project.id)[0]?.pullRequest).toBeUndefined();
  } finally { await fixture.dispose(); }
});
