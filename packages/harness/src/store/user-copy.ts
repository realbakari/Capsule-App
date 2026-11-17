import path from "node:path";
import { isNewerRelease, type AgentUpdateVia, type AgentUserUpdate, type HarnessId } from "@capsule/shared";

/*
 * A copy of an agent the user installed: who owns it, what version it is, and
 * how to bring it up to date. Pure functions over paths, so every package
 * manager's layout is testable without that manager installed.
 *
 * Ownership is read from where the program really lives (its real path after
 * symlinks), because that is what the owning tool wrote. A layout Capsule does
 * not recognise is `unknown`: it gets no update offer rather than a guess.
 */
export type CopyOwner =
  | { kind: "npm"; packageName: string; packageDir: string; prefix: string }
  | { kind: "pnpm"; packageName: string; packageDir: string }
  | { kind: "bun"; packageName: string; packageDir: string }
  | { kind: "homebrew"; name: string; cask: boolean; prefix: string; version: string }
  | { kind: "self"; args: string[]; packageName?: string; version?: string }
  | { kind: "unknown" };

/*
 * CLIs that ship their own updater and install into a versioned folder of
 * their own. The folder name is the installed version.
 */
const SELF_UPDATING: Array<{ harnessId: HarnessId; folder: RegExp; args: string[]; packageName?: string }> = [
  { harnessId: "claude", folder: /\/\.local\/share\/claude\/versions\/([^/]+)/, args: ["update"], packageName: "@anthropic-ai/claude-code" },
  { harnessId: "cursor", folder: /\/\.local\/share\/cursor-agent\/versions\/([^/]+)/, args: ["update"] },
];

const PNPM_GLOBAL = /\/(?:library\/pnpm|\.local\/share\/pnpm|appdata\/local\/pnpm|pnpm\/global)\//;
const BUN_GLOBAL = /\/\.bun\/install\/global\/node_modules\//;
const HOMEBREW_KEG = /^(.*)\/(Cellar|Caskroom)\/([^/]+)\/([^/]+)\//i;

function slashes(value: string): string {
  return value.replaceAll("\\", "/");
}

/** The package that holds `file`: the last `node_modules/<name>` segment, scoped names included. */
function owningPackage(file: string): { packageName: string; packageDir: string } | undefined {
  const at = file.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const rest = file.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  if (!name || name.endsWith("/")) return undefined;
  return { packageName: name, packageDir: `${file.slice(0, at)}/node_modules/${name}` };
}

export function copyOwner(input: { harnessId: HarnessId; realPath: string }): CopyOwner {
  const real = slashes(input.realPath);
  const lower = real.toLowerCase();

  const keg = HOMEBREW_KEG.exec(real);
  if (keg) {
    return { kind: "homebrew", prefix: keg[1]!, cask: keg[2]!.toLowerCase() === "caskroom", name: keg[3]!, version: keg[4]!.replace(/_\d+$/, "") };
  }
  const self = SELF_UPDATING.find((item) => item.harnessId === input.harnessId && item.folder.test(real));
  if (self) {
    return { kind: "self", args: self.args, ...(self.packageName ? { packageName: self.packageName } : {}), version: self.folder.exec(real)![1]! };
  }
  const owned = owningPackage(real);
  if (!owned) return { kind: "unknown" };
  if (BUN_GLOBAL.test(lower)) return { kind: "bun", ...owned };
  if (PNPM_GLOBAL.test(lower)) return { kind: "pnpm", ...owned };
  /* An npm global sits at `<prefix>/lib/node_modules/<package>`, with no other node_modules above it. */
  const lib = `/lib/node_modules/${owned.packageName}`;
  if (owned.packageDir.endsWith(lib)) {
    const prefix = owned.packageDir.slice(0, -lib.length);
    if (!prefix.includes("/node_modules/")) return { kind: "npm", ...owned, prefix: prefix || "/" };
  }
  return { kind: "unknown" };
}

/** Where to look up the newest release, if anywhere. */
export function latestSource(owner: CopyOwner): { npm: string } | { homebrew: string; cask: boolean } | undefined {
  switch (owner.kind) {
    case "npm":
    case "pnpm":
    case "bun":
      return { npm: owner.packageName };
    case "self":
      return owner.packageName ? { npm: owner.packageName } : undefined;
    case "homebrew":
      return { homebrew: owner.name, cask: owner.cask };
    case "unknown":
      return undefined;
  }
}

/** The installed version when the layout says it without running anything. */
export function versionFromLayout(owner: CopyOwner): string | undefined {
  return owner.kind === "homebrew" || owner.kind === "self" ? owner.version : undefined;
}

/** The first version-shaped word of `--version` output, such as `2.0.14` in `2.0.14 (Claude Code)`. */
export function parseVersionOutput(output: string): string | undefined {
  return /\bv?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/.exec(output)?.[1];
}

export interface UpdateTools {
  npm?: string;
  pnpm?: string;
  bun?: string;
  brew?: string;
  exists: (file: string) => boolean;
}

/**
 * The update for one copy: argv Capsule may run, and the command a person
 * would type. Undefined when nothing is newer or the owner is unknown.
 */
export function userUpdatePlan(input: {
  owner: CopyOwner;
  commandPath: string;
  version?: string;
  latest?: string;
  tools: UpdateTools;
  platform: NodeJS.Platform;
}): (AgentUserUpdate & { argv?: string[] }) | undefined {
  const { owner, latest, version, tools } = input;
  if (!latest || !version || !isNewerRelease(latest, version)) return undefined;
  const join = (...parts: string[]) => (input.platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts));
  const plan = (via: AgentUpdateVia, command: string, argv: string[] | undefined) =>
    ({ via, command, oneClick: Boolean(argv), ...(argv ? { argv } : {}) });
  switch (owner.kind) {
    case "npm": {
      /* The npm beside the prefix is the one that installed it; another npm on PATH may own a different prefix. */
      const local = join(owner.prefix, "bin", input.platform === "win32" ? "npm.cmd" : "npm");
      const npm = tools.exists(local) ? local : tools.npm;
      const spec = `${owner.packageName}@${latest}`;
      return plan("npm", `npm install -g ${spec}`, npm ? [npm, "install", "-g", "--prefix", owner.prefix, spec] : undefined);
    }
    case "pnpm": {
      const spec = `${owner.packageName}@${latest}`;
      return plan("pnpm", `pnpm add -g ${spec}`, tools.pnpm ? [tools.pnpm, "add", "-g", spec] : undefined);
    }
    case "bun": {
      const spec = `${owner.packageName}@latest`;
      return plan("bun", `bun add -g ${spec}`, tools.bun ? [tools.bun, "add", "-g", spec] : undefined);
    }
    case "homebrew": {
      const local = join(owner.prefix, "bin", "brew");
      const brew = tools.exists(local) ? local : tools.brew;
      const args = ["upgrade", ...(owner.cask ? ["--cask"] : []), owner.name];
      return plan("homebrew", `brew ${args.join(" ")}`, brew ? [brew, ...args] : undefined);
    }
    case "self":
      return plan("self", [path.basename(input.commandPath), ...owner.args].join(" "), [input.commandPath, ...owner.args]);
    case "unknown":
      return undefined;
  }
}
