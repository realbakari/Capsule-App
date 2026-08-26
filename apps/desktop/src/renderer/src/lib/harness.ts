import type { HarnessStatus } from "@capsule/shared";

/*
 * Renderer-side projections of harness catalog facts.
 *
 * These read the harness list Capsule already receives over IPC rather than
 * importing the catalog from @capsule/shared. The catalog is projected to the
 * frontend, never imported into it, so there is still one source of truth in
 * the main process.
 */

/**
 * The display name for a harness id. Components must not branch on the id —
 * `harnessId === "codex" ? "Codex" : "Claude Code"` silently mislabels every
 * other ACP target as Claude Code.
 */
export function harnessDisplayName(
  harnesses: readonly HarnessStatus[],
  id: string | undefined,
  fallback = "Agent",
): string {
  if (!id) return fallback;
  return harnesses.find((harness) => harness.id === id)?.name ?? fallback;
}

/** Harnesses surfaced in the main Runtimes list rather than under "Other ACP targets". */
export function isFeaturedHarness(harness: { featured?: boolean }): boolean {
  return harness.featured === true;
}
