import { useEffect, useState } from "react";
import { LandingPage } from "./LandingPage";
import { PublicPage } from "./PublicPage";
import { publicPageForPath } from "./site-content";

/*
 * The demo shot embeds the real app, and Capsule's shell is a three-column
 * desktop layout. Below the breakpoint, use a labelled task-and-diff
 * illustration rather than shrinking the app until its text is unreadable.
 */
const WIDE = "(min-width: 900px)";

export function WebRoot() {
  const page = publicPageForPath(window.location.pathname);
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(WIDE).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (page) document.title = `${page.title} · Capsule`;
  }, [page]);
  return page ? <PublicPage slug={page.slug} /> : <LandingPage demo={wide} />;
}
