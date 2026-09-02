/**
 * What someone means when they name a repository.
 *
 * The clone dialog took a URL, so `owner/repo` — the way anyone actually
 * refers to a GitHub repository — failed with a git error about a path that
 * does not exist.
 */
export function normalizeCloneUrl(input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  // Already a URL, or scp-style git@host:owner/repo.
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) || /^[^\s@]+@[^\s:]+:.+/u.test(value)) return value;
  const shorthand = /^(?:github\.com\/|gh:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(value);
  if (!shorthand) return undefined;
  return `https://github.com/${shorthand[1]}/${shorthand[2]}.git`;
}

/** The folder name a clone URL would produce. */
export function cloneFolderName(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/u, "").replace(/\/+$/u, "");
  const last = trimmed.split(/[/:]/u).pop();
  return last && /[\w.-]/u.test(last) ? last : undefined;
}
