import type { WorktreeBases } from "@capsule/shared";

export interface WorktreeBaseOption {
  id: string;
  label: string;
  detail?: string;
  group?: string;
}

/** What the default means for this repository, in a sentence. */
export function defaultBaseDetail(bases: WorktreeBases): string {
  if (!bases.remote) {
    return `No remote: new worktrees start from this folder's current commit${bases.currentBranch ? ` on ${bases.currentBranch}` : ""}.`;
  }
  if (bases.defaultRef === "HEAD") return `${bases.remote} has no default branch here, so new worktrees start from this folder's current commit.`;
  return `The default is ${bases.defaultRef}, the remote default branch. A remote branch is fetched before the worktree is made.`;
}

/**
 * Picker rows: the default first, then remote and local branches by recent
 * commit. `extra` keeps a chosen ref visible when it is not in the recent list.
 */
export function worktreeBaseOptions(bases: WorktreeBases, extra?: string, followDefault = false): WorktreeBaseOption[] {
  // A project setting stores "follow the default" as no value, so a remote
  // that renames its default branch is followed rather than pinned.
  const rows: WorktreeBaseOption[] = [followDefault
    ? { id: "", label: `Default (${bases.defaultRef})`, group: "Default" }
    : { id: bases.defaultRef, label: bases.defaultRef, group: "Default" }];
  const seen = new Set(followDefault ? [""] : [bases.defaultRef]);
  if (extra && !seen.has(extra)) {
    rows.push({ id: extra, label: extra, group: "Chosen" });
    seen.add(extra);
  }
  for (const kind of ["remote", "local"] as const) {
    for (const choice of bases.choices) {
      if (choice.kind !== kind || seen.has(choice.ref)) continue;
      seen.add(choice.ref);
      rows.push({
        id: choice.ref,
        label: choice.ref,
        group: kind === "remote" ? "Remote branches" : "Local branches",
        ...(kind === "local" && choice.ref === bases.currentBranch ? { detail: "Checked out in the project folder." } : {}),
      });
    }
  }
  return rows;
}

/** Case-insensitive match on label, detail and group, for any searchable menu. */
export function filterMenuOptions<T extends { label: string; detail?: string; group?: string }>(options: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => [option.label, option.detail, option.group].some((text) => text?.toLowerCase().includes(needle)));
}
