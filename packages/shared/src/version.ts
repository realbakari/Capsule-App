/**
 * Release version comparison for the update check.
 *
 * Deliberately small: it only has to answer "is the published release newer
 * than what is running", against tags this project produces. It is not a
 * general semver implementation and does not try to be.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers, empty for a final release. */
  pre: string[];
}

/** Parse "v1.2.3", "1.2.3-beta.2", "1.2". Returns undefined for anything else. */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    pre: match[4] ? match[4].split(".") : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // A final release outranks any prerelease of the same numbers, which is the
  // case that matters: 1.2.0 must beat 1.2.0-rc.1, not tie with it.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNum = /^\d+$/.test(left) ? Number(left) : undefined;
    const rightNum = /^\d+$/.test(right) ? Number(right) : undefined;
    if (leftNum !== undefined && rightNum !== undefined) {
      if (leftNum !== rightNum) return leftNum < rightNum ? -1 : 1;
      continue;
    }
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** -1 when a is older, 0 when equal, 1 when a is newer. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePre(a.pre, b.pre);
}

/**
 * Whether `latest` is a release worth offering over `current`.
 *
 * An unparseable tag returns false rather than guessing: telling someone an
 * update exists and sending them to a page that does not have one is worse
 * than saying nothing.
 */
export function isNewerRelease(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const now = parseVersion(current);
  if (!next || !now) return false;
  return compareVersions(next, now) > 0;
}

export type UpdateState = "up-to-date" | "update-available" | "no-releases" | "unreachable";

export interface UpdateCheck {
  state: UpdateState;
  current: string;
  /** Tag of the newest published release, when there is one. */
  latest?: string;
  /** Where to get it. */
  url?: string;
  /** Why the check could not answer, for the unreachable case. */
  detail?: string;
}
