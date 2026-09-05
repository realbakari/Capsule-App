import { expect, it, vi } from "vitest";
import type { FileEntry, FilePreview } from "@capsule/shared";
import { SkillFiles } from "./skill-files";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const preview = (path: string): FilePreview => ({ path, contents: path, kind: "text", truncated: false, size: path.length });
const file = (name: string): FileEntry => ({ name, path: name, type: "file" });

it("opens SKILL.md first and discards its delayed preview after another file is selected", async () => {
  const initial = deferred<FilePreview>();
  const files = new SkillFiles("skill", {
    listSkillFiles: async () => [file("README.md"), file("SKILL.md")],
    previewSkillFile: vi.fn((_id, path) => path === "SKILL.md" ? initial.promise : Promise.resolve(preview(path))),
  });
  await files.load();
  expect(files.getSnapshot().selected).toBe("SKILL.md");
  await files.select("README.md");
  initial.resolve(preview("SKILL.md")); await initial.promise;
  expect(files.getSnapshot().preview?.path).toBe("README.md");
});

it("clears old content immediately and ignores failures from superseded reads", async () => {
  const delayed = deferred<FilePreview>();
  const files = new SkillFiles("skill", { listSkillFiles: async () => [], previewSkillFile: (_id, path) => path === "slow" ? delayed.promise : Promise.resolve(preview(path)) });
  await files.select("first");
  const slow = files.select("slow");
  expect(files.getSnapshot().preview).toBeUndefined();
  expect(files.getSnapshot().previewLoading).toBe(true);
  await files.select("last");
  delayed.reject(new Error("Old error")); await slow;
  expect(files.getSnapshot().preview?.path).toBe("last");
  expect(files.getSnapshot().previewError).toBeUndefined();
});

it("coalesces directory clicks and allows retrying a failed directory", async () => {
  const pending = deferred<FileEntry[]>();
  const read = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([file("reference.md")]);
  const files = new SkillFiles("skill", { listSkillFiles: read, previewSkillFile: async () => preview("x") });
  const first = files.toggle("references");
  await files.toggle("references"); // collapse while loading
  await files.toggle("references"); // reopen without a second read
  expect(read).toHaveBeenCalledTimes(1);
  pending.reject(new Error("Folder unavailable")); await first;
  expect(files.getSnapshot().directoryErrors.references).toBe("Folder unavailable");
  await files.loadDirectory("references");
  expect(files.getSnapshot().directoryErrors.references).toBeUndefined();
  expect(files.getSnapshot().children.references).toHaveLength(1);
});

it("a refresh invalidates every old folder and preview response", async () => {
  const oldDirectory = deferred<FileEntry[]>();
  const oldPreview = deferred<FilePreview>();
  const files = new SkillFiles("skill", {
    listSkillFiles: (_id, relative) => relative ? oldDirectory.promise : Promise.resolve([]),
    previewSkillFile: () => oldPreview.promise,
  });
  const folder = files.toggle("old");
  const document = files.select("old.md");
  await files.load();
  oldDirectory.resolve([file("stale.md")]); oldPreview.resolve(preview("old.md"));
  await Promise.all([folder, document]);
  expect(files.getSnapshot().children).toEqual({});
  expect(files.getSnapshot().preview).toBeUndefined();
  expect(files.getSnapshot().loadingDirectories.size).toBe(0);
});
