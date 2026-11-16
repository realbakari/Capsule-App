/**
 * The point on a floating panel nearest the control that opened it, as a CSS
 * transform-origin, so a menu grows out of its trigger instead of its middle.
 */
export function originToward(anchor: { top: number; bottom: number; left: number; right: number },
  panel: { left: number; top: number; width: number; height: number }) {
  const x = Math.min(Math.max((anchor.left + anchor.right) / 2 - panel.left, 0), panel.width);
  const y = Math.min(Math.max((anchor.top + anchor.bottom) / 2 - panel.top, 0), panel.height);
  return `${Math.round(x)}px ${Math.round(y)}px`;
}

export function floatingPlacement(anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number }, viewport: { width: number; height: number },
  options: { align?: "left" | "right"; preferAbove?: boolean; maxHeight?: number } = {}) {
  const margin = 8; const gap = 6;
  const width = Math.max(0, Math.min(panel.width, viewport.width - margin * 2));
  const above = Math.max(0, anchor.top - gap - margin);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const wanted = Math.min(panel.height, options.maxHeight ?? Infinity);
  const useAbove = options.preferAbove ? above >= wanted || above > below : below < wanted && above > below;
  const maxHeight = Math.max(0, Math.min(options.maxHeight ?? Infinity, useAbove ? above : below));
  const height = Math.min(panel.height, maxHeight);
  return {
    left: Math.max(margin, Math.min(options.align === "right" ? anchor.right - width : anchor.left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(useAbove ? anchor.top - gap - height : anchor.bottom + gap, viewport.height - height - margin)),
    maxWidth: Math.max(0, viewport.width - margin * 2), maxHeight,
  };
}
