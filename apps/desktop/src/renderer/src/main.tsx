import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyStoredTheme } from "./lib/appearance";
import { createDemoBridge } from "./features/landing/demoBridge";
import { createRemoteBridge, resolveRemoteToken } from "./lib/remote-bridge";
import { WebRoot } from "./features/landing/WebRoot";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

/*
 * Before anything renders. The stylesheet is dark by default, so a light Mac
 * painted a dark window and swapped to light once settings came back over
 * IPC — the "pop" on every start.
 */
applyStoredTheme();

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

createRoot(root).render(
  <React.StrictMode>{isDesktop || remoteToken ? <App /> : <WebRoot />}</React.StrictMode>,
);

/*
 * The main process keeps the window hidden until the app says it is ready,
 * which App does once the first load has landed. On the web there is no
 * window to reveal.
 */
if (!isDesktop) {
  // Nothing to signal: the browser is already showing the page.
}
