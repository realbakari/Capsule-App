import { spawnSync } from "node:child_process";

/**
 * What source-control tooling is present on this machine.
 *
 * Capsule reports only the tools it actually uses: git for everything, and the
 * GitHub CLI for pull requests. Listing providers it has no integration for
 * would tell someone to install a tool Capsule would then ignore.
 */

export interface ToolStatus {
  id: "git" | "gh";
  name: string;
  command: string;
  installed: boolean;
  /** Parsed from the tool's own --version output. */
  version?: string;
  /** For tools that carry an identity of their own. */
  account?: string;
  /** What to do about it, when there is something to do. */
  guidance?: string;
}

/**
 * Pull a version out of a tool's banner.
 *
 * Both write "<name> version X.Y.Z (extra)", and the extra part differs per
 * install — "(Apple Git-155)" against a release date — so only the number is
 * taken. Returns undefined rather than the raw line when there is no number,
 * because a version field showing a whole sentence is worse than an empty one.
 */
export function parseToolVersion(output: string): string | undefined {
  const match = /\bversion\s+v?(\d+(?:\.\d+)*)/i.exec(output);
  return match?.[1];
}

/**
 * The account `gh auth status` reports. Its output is human prose across
 * several lines, so this looks for the one shape it has committed to.
 */
export function parseGhAccount(output: string): string | undefined {
  const match = /Logged in to \S+ account (\S+)/i.exec(output);
  return match?.[1];
}

function probe(command: string, args: string[], timeout = 2_000) {
  try {
    const result = spawnSync(command, args, { encoding: "utf8", timeout });
    return {
      ok: result.status === 0,
      // gh writes auth status to stderr, git writes its version to stdout.
      text: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    };
  } catch {
    return { ok: false, text: "" };
  }
}

export function detectSourceControlTools(): ToolStatus[] {
  const git = probe("git", ["--version"]);
  const gh = probe("gh", ["--version"]);
  const ghAuth = gh.ok ? probe("gh", ["auth", "status"]) : undefined;
  const account = ghAuth?.ok ? parseGhAccount(ghAuth.text) : undefined;

  return [
    {
      id: "git",
      name: "Git",
      command: "git",
      installed: git.ok,
      ...(git.ok ? { version: parseToolVersion(git.text) } : {}),
      ...(git.ok
        ? {}
        : {
            guidance:
              "Install the Xcode command line tools with `xcode-select --install`, or Git from git-scm.com.",
          }),
    },
    {
      id: "gh",
      name: "GitHub CLI",
      command: "gh",
      installed: gh.ok,
      ...(gh.ok ? { version: parseToolVersion(gh.text) } : {}),
      ...(account ? { account } : {}),
      ...(gh.ok
        ? account
          ? {}
          : { guidance: "Signed out. Run `gh auth login` to open pull requests from Capsule." }
        : {
            guidance:
              "Not installed. Pull request actions stay disabled without it — `brew install gh`.",
          }),
    },
  ];
}
