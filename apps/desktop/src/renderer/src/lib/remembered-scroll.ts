import { useLayoutEffect, useRef } from "react";

/**
 * Where a pane was scrolled to, remembered across unmounts.
 *
 * The inspector renders one tool at a time, so switching from Review to
 * Terminal and back unmounts the pane and its scroll position with it: read
 * halfway down a long diff, glance at the terminal, and you are back at the
 * top. The offsets live in module memory rather than storage — this is where
 * you were a moment ago, not a preference worth surviving a restart.
 */
const offsets = new Map<string, number>();

/** Forgets every remembered position. For a test, or a signed-out workspace. */
export function clearRememberedScroll(): void {
  offsets.clear();
}

/**
 * A ref for the scrolling element, restored to its last offset on mount.
 *
 * `key` should name what is being scrolled, including whose it is — a Review
 * pane's position belongs to one thread, and restoring it into another would
 * be worse than starting at the top.
 */
export function useRememberedScroll<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    /*
     * Before paint, so the pane appears where it was rather than at the top
     * for a frame and then jumping.
     */
    const saved = offsets.get(key);
    if (saved !== undefined && saved > 0) node.scrollTop = saved;

    const remember = () => {
      offsets.set(key, node.scrollTop);
    };
    node.addEventListener("scroll", remember, { passive: true });
    return () => {
      // Also on the way out: the last scroll event can precede other changes
      // to the pane, and the position at unmount is the one to come back to.
      remember();
      node.removeEventListener("scroll", remember);
    };
  }, [key]);

  return ref;
}
