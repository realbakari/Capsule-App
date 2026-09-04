import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyStoredTheme } from "./lib/appearance";
import { createDemoBridge } from "./features/landing/demoBridge";
import { createRemoteBridge, resolveRemoteToken } from "./lib/remote-bridge";
import { WebRoot } from "./features/landing/WebRoot";
import { PolicyPage, policyForPath } from "./features/landing/PolicyPage";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

/*
 * Before anything renders. The stylesheet is dark by default, so a light Mac
 * painted a dark window and swapped to light once settings came back over
 * IPC — the "pop" on every start.
 *
 * The website takes no part in that: no preload bridge means this is the
 * public site, which is dark and stays dark.
 */
applyStoredTheme(window.capsule ? undefined : "dark");

/*
 * The pet is the same bundle in a different window, chosen by the hash the
 * main process opens it with. A second Vite entry would mean a second build
 * and a second copy of everything it imports; the pet needs the same IPC
 * bridge and the same types, so it rides along.
 */
const isPet = window.location.hash === "#pet";
if (isPet) {
  /*
   * Transparent before anything paints. The pet shares the app's bundle, so
   * the app's stylesheet is already applied when this runs and the pet's own
   * arrives a moment later — that gap painted a rectangle over the desktop
   * and then became a capsule. Setting it here closes the gap; pet.css still
   * carries the rule for everything after.
   */
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  document.body.style.margin = "0";
  void (async () => {
    await import("./features/pet/pet.css" as string);
    const { Pet } = await import("./features/pet/Pet");
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <Pet />
      </React.StrictMode>,
    );
  })();
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

window.addEventListener("error", (event) => {
  console.error("Renderer error", event.error ?? event.message);
});
window.addEventListener("unhandledrejection", (event) => {
  console.error("Renderer rejection", event.reason);
});

/*
 * On the web URL there is no preload bridge. Rather than showing an error or a
 * brochure, install a read-only demo bridge and render the real application
 * over it, with the landing card on top.
 */
/*
 * Three ways in. The desktop window has a preload bridge; a paired browser
 * gets one over a socket; the public web URL gets the read-only demo. The app
 * itself cannot tell the difference.
 */
const isDesktop = Boolean(window.capsule);
const remoteToken = isDesktop ? undefined : await resolveRemoteToken();
if (!isDesktop) {
  window.capsule = remoteToken ? createRemoteBridge(remoteToken) : createDemoBridge();
}

/*
 * The public pages are reachable by their own URL — /privacy, /security,
 * /terms — because a policy nobody can link to is not published. They render
 * before the app does: they need no bridge, no data and no demo.
 */
const policy = isDesktop ? undefined : policyForPath(window.location.pathname);


// The pet window has already rendered itself; the app must not land in the
// same root behind it.
if (!isPet) {
  createRoot(root).render(
    <React.StrictMode>
      {policy ? <PolicyPage slug={policy.slug} /> : isDesktop || remoteToken ? <App /> : <WebRoot />}
    </React.StrictMode>,
  );
}

/*
 * The main process keeps the window hidden until the app says it is ready,
 * which App does once the first load has landed. On the web there is no
 * window to reveal.
 */
if (!isDesktop) {
  // Nothing to signal: the browser is already showing the page.
}
