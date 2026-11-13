import { useSyncExternalStore } from "react";

export type SurfaceTheme = "dark" | "light";

function read(): SurfaceTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.surface === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-surface"] });
  return () => observer.disconnect();
}

/** The light or dark palette actually on screen, after "follow the system" resolves. */
export function useSurfaceTheme(): SurfaceTheme {
  return useSyncExternalStore(subscribe, read, () => "dark");
}
