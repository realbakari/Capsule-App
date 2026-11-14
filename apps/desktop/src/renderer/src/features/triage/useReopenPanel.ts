import { useEffect, useRef } from "react";
import { useWorkspace } from "../../lib/workspace";

export const REOPEN_PANEL_EVENT = "capsule:reopen-panel";

/**
 * Remembers the surface the side panel showed when it was closed, so ⇧⌘T (or
 * the palette) brings back that surface rather than an empty launcher.
 */
export function useReopenPanel() {
  const { inspectorOpen, inspectorTab, setInspectorTab, setInspectorOpen, setView } = useWorkspace();
  const lastOpenTab = useRef(inspectorTab);
  const closedTab = useRef<typeof inspectorTab | undefined>(undefined);
  if (inspectorOpen) lastOpenTab.current = inspectorTab;
  const wasOpen = useRef(inspectorOpen);
  useEffect(() => {
    if (wasOpen.current && !inspectorOpen) closedTab.current = lastOpenTab.current;
    wasOpen.current = inspectorOpen;
  }, [inspectorOpen]);

  const live = useRef({ setInspectorTab, setInspectorOpen, setView, inspectorOpen });
  live.current = { setInspectorTab, setInspectorOpen, setView, inspectorOpen };
  useEffect(() => {
    const reopen = () => {
      const { setInspectorTab: tab, setInspectorOpen: open, setView: view, inspectorOpen: isOpen } = live.current;
      if (isOpen) return;
      view("chat");
      if (closedTab.current) tab(closedTab.current);
      open(true);
    };
    window.addEventListener(REOPEN_PANEL_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_PANEL_EVENT, reopen);
  }, []);
}
