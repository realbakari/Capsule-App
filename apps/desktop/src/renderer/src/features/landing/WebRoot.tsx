import { useEffect, useState } from "react";
import App from "../../App";
import { LandingPage } from "./LandingPage";

/*
 * The web URL shows the real application over a demo bridge — but only where
 * there is room for it. Capsule's shell is a three-column desktop layout; on a
 * phone it collapses into something that misrepresents the product rather than
 * demonstrating it. Below the breakpoint the landing stands alone.
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

  if (!wide) return <LandingPage standalone />;
  return (
    <>
      <App />
      <LandingPage />
    </>
  );
}
