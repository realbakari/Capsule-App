import { afterEach, describe, expect, it, vi } from "vitest";
import { linkMenuItems, runLinkAction } from "./link-actions";

const HREF = "https://example.com/docs";

describe("reply links", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("offers the panel, the system browser and copy on the desktop; open and copy elsewhere", () => {
    expect(linkMenuItems(true).map((item) => item.label)).toEqual(["Open", "Open in system browser", "Copy link"]);
    expect(linkMenuItems(false).map((item) => item.label)).toEqual(["Open", "Copy link"]);
  });

  it("opens the way a click would, in the system browser, or copies, as chosen", async () => {
    const open = vi.fn();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("window", { open });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const panel = vi.fn();

    await runLinkAction("open", HREF, panel);
    expect(panel).toHaveBeenCalledWith(HREF);
    expect(open).not.toHaveBeenCalled();

    await runLinkAction("system", HREF, panel);
    expect(open).toHaveBeenCalledWith(HREF, "_blank", "noopener");

    await runLinkAction("copy", HREF, panel);
    expect(writeText).toHaveBeenCalledWith(HREF);
    expect(panel).toHaveBeenCalledOnce();
  });

  it("reports a copy the clipboard refused", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: async () => { throw new Error("denied"); } } });
    await expect(runLinkAction("copy", HREF, () => {})).rejects.toThrow("denied");
  });
});
