import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createDemoBridge } from "./features/landing/demoBridge";
import { WebRoot } from "./features/landing/WebRoot";
import "./styles.css";

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
const isDesktop = Boolean(window.capsule);
if (!isDesktop) {
  window.capsule = createDemoBridge();
}

createRoot(root).render(
  <React.StrictMode>{isDesktop ? <App /> : <WebRoot />}</React.StrictMode>,
);
