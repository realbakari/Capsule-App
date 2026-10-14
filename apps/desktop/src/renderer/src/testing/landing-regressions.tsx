import { createRoot } from "react-dom/client";
import { WebRoot } from "../features/landing/WebRoot";
import { PolicyPage } from "../features/landing/PolicyPage";
import { PublicPage } from "../features/landing/PublicPage";
import { PUBLIC_PAGES } from "../features/landing/site-content";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

export async function runLandingRegressions() {
  const host = document.getElementById("root");
  const styles = document.querySelector<HTMLStyleElement>("#composer-test-styles");
  assert(host && styles, "Landing test host missing");
  const previousMedia = styles.media;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const root = createRoot(host);
  let copied = "";
  try {
    styles.media = "all";
    root.render(<WebRoot />); await settle();
    const page = host.querySelector<HTMLElement>(".site");
    assert(page, "Public landing page did not render");
    assert(page.scrollWidth <= page.clientWidth, "Landing page overflows horizontally");
    assert(page.scrollHeight > page.clientHeight, "Landing page cannot scroll");
    assert(Boolean(page.querySelector("iframe")) === (innerWidth >= 900), "Preview does not match the viewport");
    for (const link of Array.from(page.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
      assert(page.querySelector(link.hash), `Missing section target ${link.hash}`);
    }
    const question = page.querySelector<HTMLDetailsElement>(".site-question-list details");
    const summary = question?.querySelector("summary");
    assert(question && summary, "Setup answer missing");
    assert(!question.open, "Setup details should begin collapsed");
    summary.click(); await settle();
    assert(question.open && question.innerText.includes("ACP adapter"), "Setup answer does not expand");
    summary.click(); await settle();
    assert(!question.open, "Setup answer cannot be closed");
    const source = page.querySelector<HTMLDetailsElement>(".site-source");
    assert(source, "Source installation missing");
    source.querySelector("summary")?.click(); await settle();
    const copy = source.querySelector<HTMLButtonElement>("button");
    assert(copy, "Source copy action missing");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
    copy.click(); await settle();
    assert(copied === source.querySelector("code")?.textContent && source.textContent?.includes("Command copied."), "Copy did not use the displayed command");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    copy.click(); await settle();
    assert(source.textContent?.includes("Select and copy"), "Clipboard failure has no recovery");
    for (const route of PUBLIC_PAGES) {
      root.render(<PublicPage slug={route.slug} />); await settle();
      const publicPage = host.querySelector<HTMLElement>(".site");
      assert(publicPage && publicPage.scrollWidth <= publicPage.clientWidth, `${route.slug} overflows`);
      assert(host.querySelector("main h1")?.textContent === route.title, `Wrong page at ${route.slug}`);
      assert(host.querySelectorAll("main h1").length === 1, `${route.slug} has competing page headings`);
    }
    root.render(<PublicPage slug="features" />); await settle();
    const tourTabs = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const reviewTab = tourTabs[1];
    const approvalTab = tourTabs[2];
    assert(reviewTab && approvalTab, "Tour tabs missing");
    reviewTab.click(); await settle();
    assert(host.querySelector('[role="tabpanel"]')?.textContent?.includes("See exactly what changed."), "Tour tab did not change its content");
    reviewTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle();
    assert(approvalTab.getAttribute("aria-selected") === "true" && document.activeElement === approvalTab, "Tour keyboard navigation did not move focus and selection");
    root.render(<PublicPage slug="resources" />); await settle();
    const category = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Connections");
    category?.click(); await settle();
    assert(host.querySelectorAll(".site-resource-card").length === 2 && host.textContent?.includes("Open your workspace in a browser"), "Resource category did not filter guides");
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    assert(search, "Guide search missing");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "no-such-guide");
    search.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    assert(host.textContent?.includes("No matching guides"), "Guide search has no empty result");
    Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Show all guides")?.click(); await settle();
    assert(search.value === "" && host.querySelectorAll(".site-resource-card").length === 9, "Guide search cannot recover from an empty result");
    for (const slug of ["privacy", "security", "terms"]) {
      root.render(<PolicyPage slug={slug} />); await settle();
      const policy = host.querySelector<HTMLElement>(".site");
      const body = policy?.querySelector(".policy-body");
      assert(policy && body, `Missing ${slug} page`);
      assert(body.querySelectorAll("h1").length === 1, `${slug} page is missing its main heading`);
      assert(policy.scrollWidth <= policy.clientWidth, `${slug} page overflows`);
      assert(getComputedStyle(body).color === "rgb(101, 102, 95)", "Policy text inherited the desktop dark palette");
    }
  } finally {
    root.unmount(); styles.media = previousMedia;
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
  return `Landing regressions passed (${innerWidth}px)`;
}
