/** Operates only on the isolated browser partition supplied by the owner. */
export async function clearBrowserData(
  session: { clearCache: () => Promise<void>; clearStorageData: () => Promise<void> },
  kind: "cache" | "storage",
): Promise<void> {
  if (kind === "cache") await session.clearCache();
  else if (kind === "storage") await session.clearStorageData();
  else throw new Error("Unknown browser data operation.");
}
