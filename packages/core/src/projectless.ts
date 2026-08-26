import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const INBOX_PROJECT_NAME = "Inbox";

export function defaultProjectlessFolder(home = os.homedir()): string {
  return path.join(home, "Documents", "Capsule");
}

export function isInboxProject(project: { name: string }): boolean {
  return project.name === INBOX_PROJECT_NAME;
}

export function slugForTask(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

export function allocateThreadFolder(
  root: string,
  title: string,
  now = new Date(),
): string {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const base = path.join(root, day, slugForTask(title));
  let folder = base;
  let index = 2;
  while (fs.existsSync(folder)) {
    folder = `${base}-${index}`;
    index += 1;
  }
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function ensureProjectlessFolder(root: string): string {
  fs.mkdirSync(root, { recursive: true });
  return root;
}
