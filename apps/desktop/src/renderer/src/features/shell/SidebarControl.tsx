import { useWorkspace } from "../../lib/workspace";
import { PanelLeftIcon } from "./icons";

/** Hide/show control. Must live inside a drag titlebar so Electron no-drag clicks work. */
export function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar } = useWorkspace();
  return (
    <button
      type="button"
      className="icon-btn sidebar-toggle"
      data-sidebar-control=""
      title={sidebarCollapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
      aria-label={sidebarCollapsed ? "Show sidebar (⌘B)" : "Hide sidebar (⌘B)"}
      aria-pressed={!sidebarCollapsed}
      onClick={toggleSidebar}
    >
      <PanelLeftIcon />
    </button>
  );
}
