import type {
  GitPullRequest,
  GitPullRequestStack,
  GitPullRequestStackAction,
  GitPullRequestStackLayer,
} from "@capsule/shared";

function layerState(state: string): "open" | "merged" | "closed" {
  const value = state.trim().toLowerCase();
  if (value === "merged") return "merged";
  if (value === "closed") return "closed";
  return "open";
}

/** Same rule as the host: every layer from the base through this PR must be open and not a draft. */
export function mergeLayersThrough(
  stack: GitPullRequestStack,
  number: number,
): GitPullRequestStackLayer[] | undefined {
  const index = stack.layers.findIndex((layer) => layer.number === number);
  if (index < 0) return undefined;
  const slice = stack.layers.slice(0, index + 1);
  if (slice.some((layer) => layerState(layer.state) !== "open" || layer.isDraft)) return undefined;
  return slice;
}

export function stackActionFromDetail(
  url: string,
  number: number,
  stack: GitPullRequestStack,
  layers: readonly GitPullRequestStackLayer[],
): GitPullRequestStackAction | undefined {
  const heads = layers.flatMap((layer) =>
    layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
  );
  if (heads.length === 0 || heads.length !== layers.filter((layer) => layer.state.toLowerCase() !== "merged").length) {
    return undefined;
  }
  return { number, url, stackNumber: stack.number, heads };
}

export function mergePrompt(stack: GitPullRequestStack, number: number): string {
  const below = mergeLayersThrough(stack, number) ?? [];
  const others = below.filter((layer) => layer.number !== number);
  if (others.length === 0) {
    return `Merge pull request #${number} into ${stack.base}. GitHub rebases any remaining layers after the merge.`;
  }
  return `Merge #${number} and ${others.length} open layer${others.length === 1 ? "" : "s"} below it into ${stack.base} (#${others.map((layer) => layer.number).join(", #")}). GitHub rebases any remaining layers after the merge.`;
}

export function rebasePrompt(stack: GitPullRequestStack): string {
  return `Rebase this ${stack.layers.length}-layer stack onto ${stack.base} on GitHub, from the bottom up. Remote branches are rewritten and checks restart. Your local checkout is not changed.`;
}

export function stackSearchText(item: GitPullRequest): string {
  return item.stack ? `${item.stack.position}/${item.stack.size}` : "";
}
