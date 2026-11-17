import { useEffect, useState } from "react";
import type { SearchResults } from "@capsule/shared";
import { formatUserError } from "./errors";

/** Shorter queries match too much text to be worth a search. */
export const MESSAGE_SEARCH_MIN = 2;
const DEBOUNCE_MS = 150;

/**
 * Searches message text as the person types, a beat after they pause. The
 * last results stay on screen until the next ones arrive, so a list being
 * read does not blink empty on every keystroke; `pending` says newer ones
 * are on the way.
 */
export function useMessageSearch(api: { search: (query: string) => Promise<SearchResults> }, query: string, enabled: boolean) {
  const needle = query.trim();
  const active = enabled && needle.length >= MESSAGE_SEARCH_MIN;
  const [result, setResult] = useState<{ query: string; hits?: SearchResults; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(() => {
      api.search(needle).then(
        (hits) => { if (current) setResult({ query: needle, hits }); },
        (error: unknown) => { if (current) setResult({ query: needle, error: formatUserError(error) }); },
      );
    }, DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [api, active, needle, attempt]);
  const settled = result?.query === needle;
  return {
    active,
    messages: active ? result?.hits?.messages ?? [] : [],
    error: active && settled ? result.error : undefined,
    pending: active && !settled,
    retry: () => setAttempt((value) => value + 1),
  };
}
