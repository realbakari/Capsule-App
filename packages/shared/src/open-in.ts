/**
 * Apps a project folder or file can be opened in.
 *
 * Capsule names no editors. The list is what the operating system reports
 * can open the target, plus any app the user added by picking it, each with
 * the name and icon the system gives it.
 */

/** The pseudo-app that hands the target to the system's default handler. */
export const OPEN_IN_DEFAULT_APP = "default";

export interface OpenInApp {
  /** The app's location on disk (a bundle on macOS, an executable elsewhere), or OPEN_IN_DEFAULT_APP. */
  id: string;
  name: string;
  /** A data URL for the icon the system shows for this app. */
  icon?: string;
  /** Added by the user rather than reported by the system. */
  added: boolean;
}

export interface OpenInCatalog {
  apps: OpenInApp[];
  /** The app the shortcut and the primary button use, when it is still in the list. */
  favorite?: string;
  /** System-reported apps the user removed, so Settings can offer them back. */
  hidden: number;
  /**
   * `system`: the OS lists the apps that can open the target.
   * `manual`: this platform gives no such list; only the default app and added apps appear.
   */
  discovery: "system" | "manual";
}

/** What to open: the conversation's folder, or a path inside the project's folders. */
export interface OpenInTarget {
  projectId: string;
  sessionId?: string;
  /** Absolute, or relative to the conversation's folder. Omitted means the folder itself. */
  path?: string;
}

/** The picker's order: the favourite first, the rest as the system listed them. */
export function orderOpenInApps(catalog: Pick<OpenInCatalog, "apps" | "favorite">): OpenInApp[] {
  const favorite = catalog.apps.find((app) => app.id === catalog.favorite);
  return favorite ? [favorite, ...catalog.apps.filter((app) => app !== favorite)] : catalog.apps;
}

/** The favourite, if the user has one and it can still open this target. */
export function favoriteOpenInApp(catalog: Pick<OpenInCatalog, "apps" | "favorite"> | undefined): OpenInApp | undefined {
  return catalog?.apps.find((app) => app.id === catalog.favorite);
}

/**
 * The visible list: system apps the user did not remove, then added apps the
 * system did not already report.
 */
export function mergeOpenInApps(
  system: ReadonlyArray<Omit<OpenInApp, "added">>,
  added: ReadonlyArray<Omit<OpenInApp, "added">>,
  hidden: ReadonlyArray<string>,
): OpenInApp[] {
  const removed = new Set(hidden);
  const seen = new Set<string>();
  const apps: OpenInApp[] = [];
  for (const app of system) {
    if (removed.has(app.id) || seen.has(app.id)) continue;
    seen.add(app.id);
    apps.push({ ...app, added: false });
  }
  for (const app of added) {
    if (seen.has(app.id)) continue;
    seen.add(app.id);
    apps.push({ ...app, added: true });
  }
  return apps;
}
