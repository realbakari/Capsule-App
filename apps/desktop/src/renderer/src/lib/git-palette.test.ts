import { expect, it } from "vitest";
import type { GitStatus } from "@capsule/shared";
import { gitPaletteRows } from "./git-palette";

const git = (patch: Partial<GitStatus> = {}): GitStatus => ({
  available: true, isRepo: true, branch: "feature", dirty: true, changed: 2, summary: "", files: [], branches: ["feature"],
  upstream: "origin/feature", pushRemote: "origin", ahead: 0, behind: 0, ...patch,
});
const rows = (status: GitStatus | undefined, desktop = true, hasProject = true) =>
  Object.fromEntries(gitPaletteRows(status, { desktop, hasProject }).map((row) => [row.id, row]));

it("says why each git row cannot run", () => {
  expect(rows(git(), false)["git-commit"]!.disabledReason).toBe("Available in the desktop app.");
  expect(rows(undefined, true, false)["git-push"]!.disabledReason).toBe("Open a project first.");
  expect(rows(git({ isRepo: false }))["git-switch-branch"]!.disabledReason).toBe("This folder is not a Git repository.");
  expect(rows(git({ dirty: false }))["git-commit"]!.disabledReason).toBe("Nothing to commit. The working tree is clean.");
  expect(rows(git())["git-push"]!.disabledReason).toBe("Nothing to push: origin/feature has every commit.");
  expect(rows(git({ pullRequest: { number: 7, url: "u", title: "t", state: "OPEN" } as GitStatus["pullRequest"] }))["git-pull-request"]!.disabledReason).toBe("Pull request #7 is already open.");
});

it("names the sync action the branch needs", () => {
  expect(rows(git({ behind: 2 }))["git-pull"]).toMatchObject({ label: "Pull 2 commits", action: "pull", disabledReason: undefined });
  expect(rows(git({ behind: 2 }))["git-push"]!.disabledReason).toMatch(/^Pull first/);
  expect(rows(git({ ahead: 1, behind: 1 }))["git-pull"]).toMatchObject({ label: "Rebase onto origin/feature", action: "rebase" });
  expect(rows(git({ upstream: undefined }))["git-push"]).toMatchObject({ label: "Publish branch", disabledReason: undefined });
  expect(rows(git({ ahead: 3 }))["git-push"]).toMatchObject({ label: "Push 3 commits", disabledReason: undefined });
});
