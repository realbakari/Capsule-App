import { IpcArgumentError, type ArgParser } from "@capsule/contracts";
import type { GitCommitScope } from "@capsule/shared";

const MAX_PATHS = 2_000;

/** What a commit takes: absent or `{ staged: true }` is the index as staged; `{ paths }` names the files. */
export const commitScope: ArgParser<GitCommitScope> = (value, channel, index) => {
  if (value === undefined) return { staged: true };
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IpcArgumentError(channel, index, "must be an object");
  const raw = value as { staged?: unknown; paths?: unknown };
  if (raw.staged === true && raw.paths === undefined) return { staged: true };
  if (!Array.isArray(raw.paths) || raw.paths.length === 0 || raw.paths.length > MAX_PATHS
    || raw.paths.some((item) => typeof item !== "string" || !item || item.includes("\0"))) {
    throw new IpcArgumentError(channel, index, `must be { staged: true } or 1 to ${MAX_PATHS} file paths`);
  }
  return { paths: raw.paths as string[] };
};
