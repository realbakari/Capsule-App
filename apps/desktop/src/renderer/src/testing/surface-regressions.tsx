import { createRoot } from "react-dom/client";

const popovers = ["menu-select-pop", "action-menu", "topbar-dropdown-menu", "composer-tools-popover", "agent-command-popover", "context-card", "sidebar-thread-preview"];
const dialogs = ["dialog", "palette", "about-modal-card", "palette search-dialog"];

/** Exercise the actual cascade, including OS-following theme tokens. */
export async function runSurfaceRegressions(theme: "dark" | "light" | "system") {
  const element = document.documentElement;
  const savedTheme = element.dataset.theme;
  const savedStyle = element.style.cssText;
  const sheet = document.querySelector<HTMLStyleElement>("#composer-test-styles")!;
  const savedMedia = sheet.media;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    sheet.media = "all";
    element.dataset.theme = theme;
    element.style.cssText = "";
    root.render(<>{[...popovers, ...dialogs].map((name) => <div key={name} className={name} data-surface={name}>Surface</div>)}</>);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const surface = (name: string) => {
      const node = host.querySelector<HTMLElement>(`[data-surface="${name}"]`);
      if (!node) throw new Error(`Missing surface: ${name}`);
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, text: style.color, border: style.borderColor, radius: style.borderRadius, shadow: style.boxShadow };
    };
    const popup = surface(popovers[0]!);
    for (const name of popovers) {
      if (JSON.stringify(surface(name)) !== JSON.stringify(popup)) throw new Error(`${theme}: inconsistent popup ${name}`);
    }
    const dialog = surface(dialogs[0]!);
    for (const name of dialogs) {
      if (JSON.stringify(surface(name)) !== JSON.stringify(dialog)) throw new Error(`${theme}: inconsistent dialog ${name}`);
    }
    if (dialog.background !== popup.background || dialog.text !== popup.text) throw new Error(`${theme}: dialog does not follow the popup theme`);
    const light = theme === "light" || (theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
    if (light && (dialog.background !== "rgb(255, 255, 255)" || dialog.text !== "rgb(22, 22, 20)")) throw new Error(`Light dialog has unreadable colours: ${JSON.stringify(dialog)}; theme=${element.dataset.theme}; inline=${element.style.cssText}`);
    if (theme === "system") {
      element.dataset.theme = light ? "light" : "dark";
      if (JSON.stringify(surface(popovers[0]!)) !== JSON.stringify(popup)) throw new Error("System and explicit theme have different elevation");
    }
    return `Surface regressions passed (${theme})`;
  } finally {
    root.unmount(); host.remove(); element.style.cssText = savedStyle; sheet.media = savedMedia;
    if (savedTheme === undefined) delete element.dataset.theme;
    else element.dataset.theme = savedTheme;
  }
}
