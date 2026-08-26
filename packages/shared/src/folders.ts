export function normalizeFolderPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "") || value;
}

export function folderBasename(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const normalized = normalizeFolderPath(path.trim());
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return (index >= 0 ? normalized.slice(index + 1) : normalized) || undefined;
}

export interface ProjectFolderSource {
  workingDirectory?: string;
  extraFolders?: string[];
}

/** Primary first, then extras. Duplicates (case-insensitive) are dropped. */
export function projectFolderList(project: ProjectFolderSource): string[] {
  const primary = project.workingDirectory?.trim()
    ? normalizeFolderPath(project.workingDirectory.trim())
    : undefined;
  const extra = (project.extraFolders ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeFolderPath);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [primary, ...extra]) {
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function isAttachedFolder(project: ProjectFolderSource, path: string): boolean {
  const needle = normalizeFolderPath(path).toLowerCase();
  return projectFolderList(project).some((item) => item.toLowerCase() === needle);
}

export function addFolderToProject(
  project: ProjectFolderSource,
  path: string,
): { workingDirectory?: string; extraFolders: string[] } {
  const next = normalizeFolderPath(path.trim());
  if (!next) {
    return {
      workingDirectory: project.workingDirectory,
      extraFolders: project.extraFolders ?? [],
    };
  }
  const folders = projectFolderList({
    workingDirectory: project.workingDirectory,
    extraFolders: [...(project.extraFolders ?? []), next],
  });
  const [primary, ...extra] = folders;
  return { workingDirectory: primary, extraFolders: extra };
}

export function removeFolderFromProject(
  project: ProjectFolderSource,
  path: string,
): { workingDirectory?: string; extraFolders: string[] } {
  const needle = normalizeFolderPath(path).toLowerCase();
  const folders = projectFolderList(project).filter((item) => item.toLowerCase() !== needle);
  const [primary, ...extra] = folders;
  return { workingDirectory: primary, extraFolders: extra };
}

export function makePrimaryFolder(
  project: ProjectFolderSource,
  path: string,
): { workingDirectory?: string; extraFolders: string[] } {
  const next = normalizeFolderPath(path.trim());
  if (!next) {
    return {
      workingDirectory: project.workingDirectory,
      extraFolders: project.extraFolders ?? [],
    };
  }
  const others = projectFolderList(project).filter((item) => item.toLowerCase() !== next.toLowerCase());
  return { workingDirectory: next, extraFolders: others };
}
