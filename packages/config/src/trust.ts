import path from "node:path";

/** The folders whose executable entries the user has agreed to run. */
export interface TrustStore {
  isTrusted(root: string): boolean;
  trust(root: string): void;
  revoke(root: string): void;
  list(): Array<{ root: string; trustedAt: string }>;
}

/**
 * A trust store kept as one JSON value, `{ [root]: trustedAt }`. The engine
 * backs it with a SQLite setting; tests back it with a variable.
 */
export function createTrustStore(storage: { read(): string | undefined; write(value: string): void }, now: () => Date = () => new Date()): TrustStore {
  const load = (): Record<string, string> => {
    try {
      const parsed: unknown = JSON.parse(storage.read() ?? "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch {
      return {};
    }
  };
  const key = (root: string) => path.resolve(root);
  return {
    isTrusted: (root) => Object.hasOwn(load(), key(root)),
    trust: (root) => {
      const folders = load();
      if (Object.hasOwn(folders, key(root))) return;
      storage.write(JSON.stringify({ ...folders, [key(root)]: now().toISOString() }));
    },
    revoke: (root) => {
      const folders = load();
      if (!Object.hasOwn(folders, key(root))) return;
      delete folders[key(root)];
      storage.write(JSON.stringify(folders));
    },
    list: () => Object.entries(load()).map(([root, trustedAt]) => ({ root, trustedAt })),
  };
}
