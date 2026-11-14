import { IpcArgumentError, type ArgParser } from "@capsule/contracts";
import type { HunkApply, PatchApplication } from "@capsule/shared";

const PATCH_BYTES = 4 * 1024 * 1024;
const MAX_CHECKS = 200;

function part(value: unknown, channel: string, index: number): PatchApplication | undefined {
  if (value === undefined) return undefined;
  const candidate = value as { patch?: unknown; reverse?: unknown } | null;
  if (typeof candidate !== "object" || candidate === null || typeof candidate.patch !== "string" || typeof candidate.reverse !== "boolean") {
    throw new IpcArgumentError(channel, index, "must hold a patch string and a reverse flag");
  }
  if (!candidate.patch.startsWith("diff --git ") || candidate.patch.length > PATCH_BYTES) {
    throw new IpcArgumentError(channel, index, "must be a single git patch under 4 MB");
  }
  return { patch: candidate.patch, reverse: candidate.reverse };
}

/** One Review hunk action: an index part, a working-tree part, or both. */
export const hunkApply: ArgParser<HunkApply> = (value, channel, index) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IpcArgumentError(channel, index, "must be an object");
  }
  const raw = value as { index?: unknown; worktree?: unknown };
  const parsed = { index: part(raw.index, channel, index), worktree: part(raw.worktree, channel, index) };
  if (!parsed.index && !parsed.worktree) throw new IpcArgumentError(channel, index, "must change the index or the working tree");
  return { ...(parsed.index ? { index: parsed.index } : {}), ...(parsed.worktree ? { worktree: parsed.worktree } : {}) };
};

export const hunkApplies: ArgParser<HunkApply[]> = (value, channel, index) => {
  if (!Array.isArray(value) || value.length > MAX_CHECKS) {
    throw new IpcArgumentError(channel, index, `must be a list of at most ${MAX_CHECKS} hunk actions`);
  }
  return value.map((item) => hunkApply(item, channel, index));
};
