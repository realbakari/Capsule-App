import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { Toasts } from "../features/toasts/Toasts";
import { ToastProvider, useToasts, type ToastInput } from "../lib/toasts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => unknown, detail: string) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Toast regression timed out: ${detail}`);
    await wait(10);
  }
}

function Show({ toasts }: { toasts: ToastInput[] }) {
  const { show } = useToasts();
  useEffect(() => { for (const toast of toasts) show(toast); }, [show, toasts]);
  return null;
}

/** A toast's time runs only while someone can read it, and an error can be read in full and copied. */
export async function runToastRegressions(host: HTMLElement) {
  const container = host.appendChild(document.createElement("div"));
  container.style.cssText = "position: fixed; inset: 0; pointer-events: none;";
  const root = createRoot(container);
  const live = () => Array.from(container.querySelectorAll<HTMLElement>(".toast:not(.is-leaving)"));
  const render = (toasts: ToastInput[]) => root.render(<ToastProvider><Toasts /><Show toasts={toasts} /></ToastProvider>);
  // The clamp lives in toasts.css, which the suite ships disabled; without it no text is cut and nothing should offer Show more.
  const styles = document.querySelector<HTMLStyleElement>("#composer-test-styles");
  const media = styles?.media;
  if (styles) styles.media = "all";
  try {
    assert(document.hasFocus(), "Toast regressions need a focused document");
    render([{ key: "brief", title: "Copied", timeoutMs: 120 }]);
    await until(() => live().length === 1, "toast shown");
    window.dispatchEvent(new Event("blur"));
    await wait(300);
    assert(live().some((toast) => toast.textContent?.includes("Copied")), "A toast timed out while the window was in the background");
    window.dispatchEvent(new Event("focus"));
    await until(() => live().length === 0, "toast leaves once the window is back");

    const detail = Array.from({ length: 12 }, (_, line) => `line ${line + 1} of the failure`).join("\n");
    render([{ key: "failure", tone: "error", title: "Could not push the branch to the remote because the remote rejected it", detail,
      action: { label: "Retry", run: () => undefined }, secondaryAction: { label: "Details", run: () => undefined } }]);
    await until(() => live().length === 1, "error toast shown");
    const toast = live()[0]!;
    const buttons = Array.from(toast.querySelectorAll("button")).map((button) => button.getAttribute("aria-label") ?? button.textContent);
    assert(buttons.includes("Copy error"), "An error toast has no way to copy its text");
    assert(buttons.includes("Retry") && buttons.includes("Details"), "A secondary action was not drawn beside the main one");
    await until(() => toast.querySelector(".toast-more"), "a clamped error offers Show more");
    const detailNode = toast.querySelector<HTMLElement>(".toast-detail")!;
    const clampedHeight = detailNode.clientHeight;
    toast.querySelector<HTMLButtonElement>(".toast-more")!.click();
    await until(() => toast.classList.contains("is-expanded"), "toast expands");
    assert(detailNode.scrollHeight > clampedHeight * 2, "Expanding did not reveal the rest of the error");
    assert(toast.querySelector(".toast-more")?.textContent === "Show less", "An expanded toast cannot be collapsed again");

    render([{ key: "short", title: "Saved" }]);
    await until(() => live().some((node) => node.textContent?.includes("Saved")), "short toast shown");
    const short = live().find((node) => node.textContent?.includes("Saved"))!;
    await wait(50);
    assert(!short.querySelector(".toast-more"), "A toast whose text fits offered Show more");
    assert(!short.querySelector(".toast-copy"), "A toast that is not an error offered Copy error");
  } finally {
    if (styles && media !== undefined) styles.media = media;
    root.unmount();
    container.remove();
  }
}
