/** How long a request may take before the person is told it is still going. */
export const SLOW_REQUEST_MS = 8_000;

/*
 * Calls that wait on the person by design (a file picker, a menu, listening)
 * or that show their own progress. A notice for them would be noise.
 */
const WAITS_ON_PERSON = new Set([
  "on", "pickDirectory", "pickFiles", "showContextMenu", "addOpenInApp", "listenPetCommand", "finishPetCommand",
  "startDictation", "finishDictation", "checkForUpdates", "downloadUpdate", "installUpdate", "rendererReady",
]);

/** "gitPush" → "git push", for a notice that names what is slow. */
export function requestLabel(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export function watchesRequest(name: string): boolean {
  return !WAITS_ON_PERSON.has(name) && !name.startsWith("terminal");
}

/**
 * The same bridge, with every watched call timed: after `delay` with no
 * answer `slow(name, true)` fires, and `slow(name, false)` once it settles.
 * Overlapping calls on one channel share one notice.
 */
export function withSlowNotice<T extends object>(api: T, slow: (name: string, waiting: boolean) => void, delay = SLOW_REQUEST_MS): T {
  const pending = new Map<string, number>();
  // Keyed by the function wrapped, so a method replaced on the bridge is wrapped afresh.
  const wrapped = new WeakMap<object, unknown>();
  const target = api;
  // An empty stand-in, so a frozen bridge's property invariants never bind the wrapper.
  return new Proxy({} as T, {
    has: (_, property) => property in target,
    ownKeys: () => Reflect.ownKeys(target),
    getOwnPropertyDescriptor: (_, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    get(_, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function" || typeof property !== "string" || !watchesRequest(property)) return value;
      const cached = wrapped.get(value);
      if (cached) return cached;
      const call = (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) return result;
        let shown = false;
        const timer = setTimeout(() => {
          shown = true;
          pending.set(property, (pending.get(property) ?? 0) + 1);
          if (pending.get(property) === 1) slow(property, true);
        }, delay);
        const settle = () => {
          clearTimeout(timer);
          if (!shown) return;
          const left = (pending.get(property) ?? 1) - 1;
          if (left > 0) pending.set(property, left);
          else { pending.delete(property); slow(property, false); }
        };
        result.then(settle, settle);
        return result;
      };
      wrapped.set(value, call);
      return call;
    },
  });
}
