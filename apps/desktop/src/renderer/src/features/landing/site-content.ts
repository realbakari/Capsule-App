export const REPO = "https://github.com/realbakari/Capsule-App";
export const DOCS = `${REPO}/blob/main/docs/user`;
export const RELEASE = "0.10.1";
export const RELEASE_URL = `${REPO}/releases/tag/v${RELEASE}`;
export const ASSETS = `${REPO}/releases/download/v${RELEASE}`;

export const PUBLIC_PAGES = [
  { slug: "features", title: "The workspace", description: "Explore conversations, change review, approvals, and browser access in Capsule." },
  { slug: "about", title: "A workspace, not another agent", description: "The ideas behind Capsule: keep your tools, follow the work, and review what changes." },
  { slug: "updates", title: "What’s new in Capsule", description: "Published releases, installation guidance, and how to keep your workspace up to date." },
  { slug: "roadmap", title: "Built in the open", description: "Follow development, understand current limits, and help shape what comes next." },
  { slug: "pricing", title: "Free workspace. Your agent account.", description: "Capsule is open-source software. Your coding agent’s subscriptions and usage are separate." },
  { slug: "resources", title: "A good place to start", description: "Guides for your first conversation, local agents, shared channels, and everyday work." },
  { slug: "faq", title: "Questions, answered", description: "Straight answers about setup, model access, privacy, and working from another device." },
  { slug: "support", title: "Let’s get you unstuck", description: "Find setup guidance, report a reproducible bug, or share a feature request." },
] as const;
export type PublicPageSlug = (typeof PUBLIC_PAGES)[number]["slug"];
export function publicPageForPath(pathname: string) {
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  return PUBLIC_PAGES.find((page) => page.slug === slug);
}

export const GUIDES = [
  { category: "Getting started", title: "Your first conversation", description: "Open a folder, choose an agent, and take a small task through review.", file: "getting-started.md", label: "01" },
  { category: "Getting started", title: "Connect your coding agent", description: "Understand sign-in, local binaries, adapters, and the controls each route carries.", file: "providers.md", label: "02" },
  { category: "Workflow", title: "Make the composer yours", description: "Use files, skills, model settings, and permission controls where you write.", file: "composer.md", label: "/" },
  { category: "Workflow", title: "Review and recover", description: "Inspect saved changes and understand what a checkpoint can restore.", file: "checkpoints.md", label: "±" },
  { category: "Workflow", title: "Preview what you’re building", description: "Keep project actions, your terminal, files, and browser close to the task.", file: "projects-and-previews.md", label: "↗" },
  { category: "Connections", title: "Open your workspace in a browser", description: "Pair a trusted device while your installed agents keep running on the host.", file: "reading-from-another-device.md", label: "↔" },
  { category: "Connections", title: "Work in shared channels", description: "Connect a relay and understand channel identity, threads, and harness routing.", file: "channels.md", label: "#" },
  { category: "Workflow", title: "Meet the desktop companion", description: "A small window onto activity, with optional gestures and local voice commands.", file: "companion.md", label: "◉" },
  { category: "Getting started", title: "Know the current limits", description: "Check platform support and route-specific behavior before relying on a feature.", file: "compatibility.md", label: "i" },
] as const;
