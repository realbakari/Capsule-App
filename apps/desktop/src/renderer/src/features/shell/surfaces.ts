import type { InspectorTab } from "../../lib/workspace";
import { CpuIcon, DiffSquareIcon, FolderIcon, GlobeIcon, MessageSquarePlusIcon, SmartphoneIcon } from "./icons";

/**
 * The panel beside the conversation shows one surface at a time. The icon bar
 * in the titlebar picks it; the panel only draws it. This table is the one
 * place that says which surfaces exist, how each is named and drawn, where it
 * sits, and why it cannot open.
 */
export type InspectorTool = "launcher" | "review" | "browser" | "simulator" | "files" | "chat" | "agents";

export interface SurfaceState {
  projectId?: string;
  git?: { isRepo?: boolean; dirty?: boolean };
  /** `false` in a paired viewer, which has no machine to run a simulator on. */
  desktop?: boolean;
  platform?: string;
}

export interface Surface {
  tool: Exclude<InspectorTool, "launcher">;
  label: string;
  detail: string;
  icon: typeof DiffSquareIcon;
  /** On the icon bar itself; the rest sit in its More menu. */
  inBar: boolean;
  shortcut?: string;
  blockedBy: (state: SurfaceState) => string | undefined;
}

/* Icon bar order after the terminal toggle: review, look, then the workspace's files. */
export const SURFACES: Surface[] = [
  {
    tool: "review",
    label: "Review",
    detail: "Changed files and their diff.",
    icon: DiffSquareIcon,
    inBar: true,
    shortcut: "⌃⇧G",
    blockedBy: ({ git }) => (git?.isRepo ? undefined : "Available for Git repositories."),
  },
  {
    tool: "browser",
    label: "Browser",
    detail: "Open a local app or URL.",
    icon: GlobeIcon,
    inBar: true,
    blockedBy: () => undefined,
  },
  {
    tool: "simulator",
    label: "Simulator",
    detail: "Watch and drive an iOS Simulator.",
    icon: SmartphoneIcon,
    inBar: true,
    blockedBy: ({ desktop, platform }) =>
      desktop === false ? "Available in the desktop app." : platform && platform !== "darwin" ? "Available on macOS with Xcode." : undefined,
  },
  {
    tool: "files",
    label: "Files",
    detail: "Browse and edit workspace files.",
    icon: FolderIcon,
    inBar: true,
    blockedBy: ({ projectId }) => (projectId ? undefined : "Open a project first."),
  },
  { tool: "agents", label: "Agents", detail: "This thread’s agent and reported delegated tasks.", icon: CpuIcon, inBar: false, blockedBy: () => undefined },
  {
    tool: "chat",
    label: "Side chat",
    detail: "Ask without interrupting the thread.",
    icon: MessageSquarePlusIcon,
    inBar: false,
    shortcut: "⌥⌘S",
    blockedBy: () => undefined,
  },
];

export function surfaceFor(tool: InspectorTool): Surface | undefined {
  return SURFACES.find((surface) => surface.tool === tool);
}

export function toolFromTab(tab: string): InspectorTool {
  if (tab === "changes" || tab === "diff") return "review";
  if (tab === "agents" || tab === "run") return "agents";
  if (tab === "chat") return "chat";
  if (tab === "browser") return "browser";
  if (tab === "simulator") return "simulator";
  if (tab === "files" || tab === "preview") return "files";
  return "launcher";
}

/** The workspace tab that shows a surface; files show the open document when there is one. */
export function tabForTool(tool: InspectorTool, hasPreview = false): InspectorTab {
  if (tool === "review") return "changes";
  if (tool === "files") return hasPreview ? "preview" : "files";
  if (tool === "launcher") return "launcher";
  return tool;
}
