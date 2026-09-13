import { folderBasename, normalizeFolderPath } from "@capsule/shared";

export function parentFolder(file: string): string {
  const normalized = normalizeFolderPath(file);
  const separator = normalized.lastIndexOf("/");
  if (separator < 0) return ".";
  const parent = normalized.slice(0, separator) || "/";
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}

/** Display a project-relative mention without changing the file's stored path. */
export function fileMentionTarget(root: string, file: string): string {
  const directory = normalizeFolderPath(root);
  const normalized = normalizeFolderPath(file);
  const prefix = directory.endsWith("/") ? directory : `${directory}/`;
  const windowsPath = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
  const withinRoot = windowsPath
    ? normalized.toLowerCase().startsWith(prefix.toLowerCase())
    : normalized.startsWith(prefix);
  return withinRoot ? normalized.slice(prefix.length) : folderBasename(file) ?? file;
}
