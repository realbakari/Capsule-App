import type { InspectorTab } from "../../lib/workspace";
import { CompareIcon, CpuIcon, DiffSquareIcon, FolderIcon, GlobeIcon, SmartphoneIcon } from "./icons";

/**
 * The panel beside the conversation shows one surface at a time. The icon bar
 * in the titlebar picks it; the panel only draws it. This table is the one
 * place that says which surfaces exist, how each is named and drawn, where it
 * sits, and why it cannot open.
 */
export type InspectorTool = "launcher" | "review" | "browser" | "simulator" | "files" | "agents" | "compare";

export interface SurfaceState {
  projectId?: string;
  git?: { isRepo?: boolean; dirty?: boolean };
  /** `false` in a paired viewer, which has no machine to run a simulator on. */
  desktop?: boolean;
  /** The comparison the selected thread is a candidate in. */
  groupId?: string;
  platform?: string;
  /** Top-level names in the conversation's folder, for telling an app the simulator can run. */
  folderNames?: readonly string[];
  /** A simulator is attached to this conversation. */
  simulatorAttached?: boolean;
}

export interface Surface {
  tool: Exclude<InspectorTool, "launcher">;
  label: string;
  detail: string;
  icon: typeof DiffSquareIcon;
  /** On the icon bar itself, always or when the state calls for it; the rest sit in its More menu. */
  inBar: boolean | ((state: SurfaceState) => boolean);
  /** A keymap command, so the shown keys follow the platform and any rebinding. */
  command?: string;
  /** One key that opens it while the panel's launcher is showing. */
  key: string;
  blockedBy: (state: SurfaceState) => string | undefined;
}

/* Icon bar order after the terminal toggle: review, look, then the workspace's files. */
export const SURFACES: Surface[] = [
  {
    tool: "review", key: "r",
    label: "Review",
    detail: "Changed files and their diff.",
    icon: DiffSquareIcon,
    // A folder known not to be a repository has nothing to review; Review waits in More.
    inBar: ({ git }) => git?.isRepo !== false,
    command: "open-review",
    // Unknown until the status loads; only a folder known not to be a repository is blocked.
    blockedBy: ({ git }) => (git?.isRepo === false ? "Available for Git repositories." : undefined),
  },
  {
    tool: "browser", key: "b",
    label: "Browser",
    detail: "Open a local app or URL.",
    icon: GlobeIcon,
    inBar: true,
    command: "open-browser",
    blockedBy: () => undefined,
  },
  {
    tool: "simulator", key: "m",
    label: "Simulator",
    detail: "Watch and drive an iOS Simulator.",
    icon: SmartphoneIcon,
    inBar: ({ folderNames, simulatorAttached }) => Boolean(simulatorAttached) || looksLikeMobileApp(folderNames ?? []),
    blockedBy: ({ desktop, platform }) =>
      desktop === false ? "Available in the desktop app." : platform && platform !== "darwin" ? "Available on macOS with Xcode." : undefined,
  },
  {
    tool: "files", key: "f",
    label: "Files",
    detail: "Browse and edit workspace files.",
    icon: FolderIcon,
    inBar: true,
    blockedBy: ({ projectId }) => (projectId ? undefined : "Open a project first."),
  },
  { tool: "agents", key: "a", label: "Agents", detail: "This thread’s agent and reported delegated tasks.", icon: CpuIcon, inBar: false, blockedBy: () => undefined },
  {
    tool: "compare", key: "c",
    label: "Compare",
    detail: "One prompt's results from several agents, side by side.",
    icon: CompareIcon,
    inBar: false,
    blockedBy: ({ groupId }) => (groupId ? undefined : "Open a thread from a comparison."),
  },
];

/*
 * A folder the simulator can run: an Xcode project or workspace, a Swift
 * package, XcodeGen or CocoaPods, an `ios` folder (React Native, Flutter,
 * Capacitor, a prebuilt Expo app) or an EAS config. Read from top-level
 * names only, so it costs nothing beyond the listing Files already has.
 */
const MOBILE_APP_MARKERS = [/\.xcodeproj$/, /\.xcworkspace$/, /^Package\.swift$/, /^project\.yml$/, /^Podfile$/, /^ios$/, /^eas\.json$/];

export function looksLikeMobileApp(names: readonly string[]): boolean {
  return names.some((name) => MOBILE_APP_MARKERS.some((marker) => marker.test(name)));
}

/** Can exist here at all: a simulator needs the desktop app on a Mac, and Compare a thread from a comparison. */
export function offered(surface: Surface, state: SurfaceState): boolean {
  if (surface.tool === "simulator") return !surface.blockedBy({ desktop: state.desktop, platform: state.platform });
  if (surface.tool === "compare") return Boolean(state.groupId);
  return true;
}

/** Worth a card in the panel's launcher: offered, and when the bar draws it only in some states, in one of those. */
export function applies(surface: Surface, state: SurfaceState): boolean {
  return offered(surface, state) && (typeof surface.inBar === "function" ? surface.inBar(state) : true);
}

/** On the bar for this state. The surface on show always is, so closing it never means a trip to More. */
export function onBar(surface: Surface, state: SurfaceState, active?: InspectorTool): boolean {
  return surface.tool === active || (typeof surface.inBar === "function" ? surface.inBar(state) : surface.inBar);
}

export function surfaceFor(tool: InspectorTool): Surface | undefined {
  return SURFACES.find((surface) => surface.tool === tool);
}

export function toolFromTab(tab: string): InspectorTool {
  if (tab === "changes" || tab === "diff") return "review";
  if (tab === "agents" || tab === "run") return "agents";
  if (tab === "browser") return "browser";
  if (tab === "simulator") return "simulator";
  if (tab === "compare") return "compare";
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
