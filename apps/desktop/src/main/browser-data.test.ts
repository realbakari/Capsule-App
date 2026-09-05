import { expect, it, vi } from "vitest";
import { clearBrowserData } from "./browser-data.js";

it("clears the requested isolated browser data and propagates failures", async () => {
  const session = { clearCache: vi.fn().mockResolvedValue(undefined), clearStorageData: vi.fn().mockResolvedValue(undefined) };
  await clearBrowserData(session, "cache");
  expect(session.clearCache).toHaveBeenCalledOnce();
  expect(session.clearStorageData).not.toHaveBeenCalled();
  await clearBrowserData(session, "storage");
  expect(session.clearStorageData).toHaveBeenCalledOnce();
  session.clearCache.mockRejectedValue(new Error("Cannot clear cache"));
  await expect(clearBrowserData(session, "cache")).rejects.toThrow("Cannot clear cache");
  session.clearStorageData.mockRejectedValue(new Error("Cannot clear storage"));
  await expect(clearBrowserData(session, "storage")).rejects.toThrow("Cannot clear storage");
});
