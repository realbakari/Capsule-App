import { withShortcut } from "../../lib/keybindings";
import { useWorkspace } from "../../lib/workspace";
import { PanelLeftIcon } from "./icons";

/** Hide/show control. Must live inside a drag titlebar so Electron no-drag clicks work. */
export function SidebarToggle() {
  const { sidebarCollapsed, toggleSidebar, keyBindings } = useWorkspace();
  const label = withShortcut(sidebarCollapsed ? "Show sidebar" : "Hide sidebar", "toggle-sidebar", keyBindings);
  return (
    <button
      type="button"
      className="icon-btn sidebar-toggle"
      data-sidebar-control=""
      title={label}
      aria-label={label}
      aria-pressed={!sidebarCollapsed}
      onClick={toggleSidebar}
    >
      <PanelLeftIcon />
    </button>
  );
}
