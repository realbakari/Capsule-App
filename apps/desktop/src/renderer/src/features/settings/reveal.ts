import { useEffect } from "react";

/*
 * A search result names a row, not only a section. Picking one opens the
 * section, unfolds the Advanced group the row sits in, scrolls it to the
 * middle and pulses it once. The title stays pending until the row renders,
 * because picking a result in another section mounts that section first.
 */
const EVENT = "capsule:reveal-setting";
let pending: string | undefined;

export function revealSetting(title: string) {
  pending = title;
  window.dispatchEvent(new Event(EVENT));
}

function findRow(title: string): HTMLElement | undefined {
  const page = document.querySelector(".settings-body");
  if (!page) return undefined;
  const rows = Array.from(page.querySelectorAll<HTMLElement>(".setting"));
  const row = rows.find((item) => item.querySelector(".setting-label")?.textContent === title)
    ?? rows.find((item) => item.querySelector(".setting-copy > div")?.textContent?.startsWith(title));
  if (row) return row;
  return Array.from(page.querySelectorAll<HTMLElement>(".card > h3, .card h3")).find((heading) => heading.textContent?.startsWith(title))?.closest<HTMLElement>(".card") ?? undefined;
}

export function useRevealSetting(section: string) {
  useEffect(() => {
    let frame = 0;
    /* On mount the section is final, so a miss clears the title. On the event it may still be switching. */
    const run = (settled: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!pending) return;
        const row = findRow(pending);
        if (!row) {
          if (settled) pending = undefined;
          return;
        }
        pending = undefined;
        for (let fold = row.closest("details"); fold; fold = fold.parentElement?.closest("details") ?? null) fold.open = true;
        row.scrollIntoView({ block: "center" });
        row.classList.remove("is-revealed");
        void row.offsetWidth;
        row.classList.add("is-revealed");
        window.setTimeout(() => row.classList.remove("is-revealed"), 1400);
      });
    };
    const onEvent = () => run(false);
    run(true);
    window.addEventListener(EVENT, onEvent);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(EVENT, onEvent);
    };
  }, [section]);
}
