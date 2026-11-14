import { useEffect, useMemo, useRef, useState } from "react";
import { createChordMatcher, SEQUENCE_TIMEOUT_MS, type ChordMatcher, type EffectiveBinding, type KeyChord, type KeymapContext } from "@capsule/shared";
import { contextStack } from "./keybindings";

/*
 * Two matchers: one for every binding, and one without the global context
 * for a key pressed in a text field with neither ⌘ nor Control. Typing a
 * letter must stay typing, even when the same letter is a global shortcut,
 * while a binding someone put in the composer context is meant for typing.
 */
interface Matchers {
  all: ChordMatcher;
  field: ChordMatcher;
  contexts: Map<ChordMatcher, string>;
}

/**
 * Listens for the effective bindings and runs each matched action. Returns
 * the first chord of a sequence while it waits for the second, for the hint.
 */
export function useKeymap(bindings: readonly EffectiveBinding[], run: (action: string) => void): KeyChord | undefined {
  const [pending, setPending] = useState<KeyChord>();
  const latest = useRef(run);
  latest.current = run;
  const matchers = useMemo<Matchers>(() => ({
    all: createChordMatcher(bindings),
    field: createChordMatcher(bindings.filter((binding) => binding.context !== "global")),
    contexts: new Map(),
  }), [bindings]);

  useEffect(() => {
    let timer: number | undefined;
    const clear = () => {
      window.clearTimeout(timer);
      setPending(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      // A field recording keys for a binding, or searching by them, gets every key itself.
      if (event.isComposing || (event.target instanceof Element && event.target.closest("[data-keymap-capture]"))) return;
      const typing = event.target instanceof HTMLElement && Boolean(event.target.closest("input, textarea, select, [contenteditable]"));
      const matcher = typing && !event.metaKey && !event.ctrlKey ? matchers.field : matchers.all;
      const stack: KeymapContext[] = contextStack(event.target);
      const key = stack.join(" ");
      if (matchers.contexts.get(matcher) !== key) {
        matcher.setContexts(stack);
        matchers.contexts.set(matcher, key);
      }
      const result = matcher.feed({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, time: event.timeStamp });
      if (result.kind === "none") {
        if (!["Meta", "Control", "Shift", "Alt"].includes(event.key)) clear();
        return;
      }
      event.preventDefault();
      if (result.kind === "pending") {
        window.clearTimeout(timer);
        setPending(result.prefix);
        timer = window.setTimeout(() => {
          matcher.reset();
          setPending(undefined);
        }, SEQUENCE_TIMEOUT_MS);
        return;
      }
      clear();
      latest.current(result.action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
    };
  }, [matchers]);

  return pending;
}
