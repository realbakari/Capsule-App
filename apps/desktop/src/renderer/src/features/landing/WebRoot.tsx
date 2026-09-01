import { useEffect, useState } from "react";
import { LandingPage } from "./LandingPage";

/*
 * The demo shot embeds the real app, and Capsule's shell is a three-column
 * desktop layout — on a phone it collapses into something that misrepresents
 * the product. Below the breakpoint the page renders without it.
 */
const WIDE = "(min-width: 900px)";

export function WebRoot() {
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(WIDE).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return <LandingPage demo={wide} />;
}
