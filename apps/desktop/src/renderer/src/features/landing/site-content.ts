/** Where the public site is served. index.html carries the same origin for the home page. */
export const SITE = "https://cpcl.dev";
export const REPO = "https://github.com/realbakari/Capsule-App";
export const DOCS = `${REPO}/blob/main/docs/user`;
export const RELEASE = "0.14.0";
export const RELEASE_DATE = "2026-11-17";
export const RELEASE_URL = `${REPO}/releases/tag/v${RELEASE}`;
export const ASSETS = `${REPO}/releases/download/v${RELEASE}`;
export const MAC_DOWNLOAD = `${ASSETS}/Capsule-${RELEASE}-arm64.dmg`;
export const WINDOWS_DOWNLOAD = `${ASSETS}/Capsule-${RELEASE}-x64-setup.exe`;

/*
 * Page titles are plain names, the way a reader looks for them in a tab or a
 * search result. The description says what is on the page, not how to feel.
 */
export const PUBLIC_PAGES = [
  { slug: "features", title: "Features", description: "Threads and worktrees, turn-by-turn review, approvals, the terminal and browser beside the chat, and everything else in Capsule." },
  { slug: "about", title: "About Capsule", description: "Why Capsule is a workspace around your coding agent instead of another agent, and the decisions that follow from that." },
  { slug: "updates", title: "Changelog", description: "What changed in each Capsule release, with installers, checksums and update instructions." },
  { slug: "roadmap", title: "Roadmap", description: "What works today, what is in preview, and where to follow the work that is next." },
  { slug: "pricing", title: "Pricing", description: "Capsule is free and open source. Your coding agent’s subscription or API usage is billed by its provider." },
  { slug: "resources", title: "Guides", description: "Setup and how-to guides for your first thread, connecting agents, reviewing changes and pairing other devices." },
  { slug: "faq", title: "Questions", description: "Answers about setup, model access, where your data goes, undoing changes and using Capsule from another device." },
  { slug: "support", title: "Support", description: "Find a guide, report a bug with the details that help, or report a security issue privately." },
] as const;
export type PublicPageSlug = (typeof PUBLIC_PAGES)[number]["slug"];
export function publicPageForPath(pathname: string) {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  return PUBLIC_PAGES.find((page) => page.slug === slug);
}

/** Agents with a preset in Capsule. Any other ACP agent can be added by command. */
export const AGENTS = [
  "Claude Code", "Codex", "Gemini CLI", "Grok Build", "GitHub Copilot", "Cursor",
  "OpenCode", "Qwen Code", "Factory Droid", "Kimi", "Kilo Code", "Kiro",
] as const;

export const GUIDES = [
  { category: "Getting started", title: "Your first conversation", description: "Add a folder, pick an agent, choose a checkout or a worktree, and take one small task through review.", file: "getting-started.md" },
  { category: "Getting started", title: "Connect your coding agent", description: "Sign-in, local binaries, ACP adapters, and which controls each runtime route carries.", file: "providers.md" },
  { category: "Workflow", title: "The composer", description: "Drafts, attachments, file mentions, skills, models and permission modes, where you write.", file: "composer.md" },
  { category: "Workflow", title: "Restore, redo and fork turns", description: "Put files or the conversation back to any turn, compare first, and redo a restore.", file: "checkpoints.md" },
  { category: "Workflow", title: "Terminal, browser and files", description: "Project actions, the terminal drawer, the built-in browser and the file tree beside a thread.", file: "projects-and-previews.md" },
  { category: "Connections", title: "Open your workspace in a browser", description: "Pair a phone or another computer. Read-only unless you grant conversation control.", file: "reading-from-another-device.md" },
  { category: "Connections", title: "Shared channels", description: "Connect a relay, then work with people and agents in channels with threads and mentions.", file: "channels.md" },
  { category: "Workflow", title: "The desktop companion", description: "A small window that shows when work is running or waiting for you, with optional voice commands.", file: "companion.md" },
  { category: "Getting started", title: "Supported behavior and limits", description: "Platform support and the differences between agents and runtime routes, before you rely on one.", file: "compatibility.md" },
] as const;
