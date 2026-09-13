import type { WebContents } from "electron";

const KEYS: Record<string, { key: string; code: string; windowsVirtualKeyCode: number; text?: string }> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

export const browserKeys = Object.keys(KEYS);

/** Fixed key operations only; no debugging port or caller-selected CDP command.
 * Unlike sendInputEvent, this works in a hidden page without stealing OS focus.
 * Keep the attachment across focus and dispatch so concurrent presses cannot
 * focus a different element in between. Never take over an existing debugger.
 */
export async function pressBrowserKey(contents: WebContents, key: string, focus: () => Promise<void>, check: () => void): Promise<void> {
  const packet = KEYS[key];
  if (!packet) throw new Error("Unsupported browser key.");
  const transport = contents.debugger;
  if (transport.isAttached()) throw new Error("The page is busy with another key operation or debugger. Retry after it finishes.");
  transport.attach("1.3");
  let owned = true;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const detached = () => { owned = false; };
  const guard = () => { if (expired) throw new Error("The key operation expired."); check(); };
  transport.on("detach", detached);
  try {
    await Promise.race([
      (async () => {
        await focus();
        guard();
        await transport.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", ...packet });
        guard();
        await transport.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: packet.key, code: packet.code, windowsVirtualKeyCode: packet.windowsVirtualKeyCode });
        guard();
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("The page did not answer the key operation in time.")); }, 9500); }),
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
    transport.removeListener("detach", detached);
    if (owned && transport.isAttached()) transport.detach();
  }
}
