import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** The value and its setter both belong to one selection, even across awaits. */
export function useScopedState<T>(scope: object, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fallback = useRef(initial).current;
  const active = useRef(scope);
  active.current = scope;
  const [stored, setStored] = useState({ scope, value: initial });
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (active.current !== scope) return;
    setStored((current) => {
      if (active.current !== scope) return current;
      const prior = current.scope === scope ? current.value : fallback;
      return { scope, value: typeof update === "function" ? (update as (value: T) => T)(prior) : update };
    });
  }, [scope]);
  return [stored.scope === scope ? stored.value : fallback, set];
}
