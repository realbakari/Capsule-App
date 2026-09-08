import type { Session } from "electron";

const configured = new WeakSet<Session>();

/** Preview pages cannot silently request device access or write downloads. */
export function secureBrowserSession(session: Session): void {
  if (configured.has(session)) return;
  configured.add(session);
  session.setPermissionRequestHandler((_guest, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event) => event.preventDefault());
}
