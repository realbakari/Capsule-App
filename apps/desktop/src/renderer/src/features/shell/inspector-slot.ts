import { createContext } from "react";

/**
 * The panel header's left side, for the surface on show. A surface with its
 * own controls (the simulator's Edit, Device and View menus) portals them
 * here so they share the row with expand and close instead of taking a row
 * of their own. Null until the header has mounted, or when a surface is
 * drawn outside the panel.
 */
export const InspectorHeadSlot = createContext<HTMLElement | null>(null);
