import type { ContentHit, FileEntry, PopupMenuItem, PopupMenuRequest } from "@capsule/shared";

type CapsuleApi = typeof window.capsule;

function api(): CapsuleApi {
  return window.capsule;
}

function isFn(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function";
}

/** Preload does not hot-reload; never call missing bridge methods directly. */
export async function searchProjectFiles(projectId: string, query = ""): Promise<FileEntry[]> {
  const capsule = api() as CapsuleApi & Record<string, unknown>;
  if (isFn(capsule.searchFiles)) {
    return (await capsule.searchFiles(projectId, query)) as FileEntry[];
  }
  if (isFn(capsule.listFiles)) {
    const entries = (await capsule.listFiles(projectId)) as FileEntry[];
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.path.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle),
    );
  }
  return [];
}

export async function searchProjectContents(projectId: string, query: string): Promise<ContentHit[]> {
  const capsule = api() as CapsuleApi & Record<string, unknown>;
  if (isFn(capsule.searchContents)) {
    return (await capsule.searchContents(projectId, query)) as ContentHit[];
  }
  return [];
}

/** Preload does not hot-reload; missing showContextMenu falls back to the in-app menu. */
export async function showNativeContextMenu(
  items: PopupMenuItem[],
  position: { x: number; y: number },
): Promise<string | null | "unavailable"> {
  const capsule = api() as CapsuleApi & Record<string, unknown>;
  if (!isFn(capsule.showContextMenu)) return "unavailable";
  const request: PopupMenuRequest = {
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      enabled: item.enabled,
      destructive: item.destructive,
      separatorBefore: item.separatorBefore,
      children: item.children,
    })),
    x: position.x,
    y: position.y,
  };
  try {
    const picked = await capsule.showContextMenu(request);
    return typeof picked === "string" ? picked : null;
  } catch {
    return "unavailable";
  }
}
