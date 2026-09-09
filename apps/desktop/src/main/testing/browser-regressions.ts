import { app, BrowserWindow } from "electron";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { browserSnapshot, browserScreenshot, type BrowserTarget } from "../browser-tools";
import { callBrowserTool } from "../browser-mcp";
import { observeBrowser, browserDiagnostics } from "../browser-diagnostics";
import { secureBrowserSession } from "../browser-security";
import { BackgroundBrowsers } from "../background-browsers";
import { copyBrowserScreenshot } from "../browser-clipboard";
import { createHash } from "node:crypto";

// No real project, profile, website, agent or sign-in is involved in this test.
const fixture = `<!doctype html><html><body>
  <label>Name <input id="name"></label><input type="password" value="password-never-in-snapshot">
  <button id="save" onclick="document.querySelector('#result').textContent='Saved'">Save</button>
  <button disabled>Disabled</button><button id="covered" style="position:absolute;left:20px;top:180px">Covered</button>
  <div style="position:absolute;left:0;top:170px;width:300px;height:70px;background:black;z-index:10"></div>
  <label>Choice <select aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select></label>
  <output id="result"></output><div style="height:3000px"></div>
  <script>document.querySelector('#name').addEventListener('input', e => document.querySelector('#result').textContent=e.target.value);</script>
</body></html>`;

void app.whenReady().then(async () => {
  const server = createServer((_request, response) => { response.setHeader("content-type", "text/html"); response.end(fixture); });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("error", () => socket.destroy());
    socket.on("data", () => socket.end());
  });
  const watchdog = setTimeout(() => app.exit(1), 20_000);
  const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const page = window.webContents;
  const target: BrowserTarget = { contents: () => page };
  const background = new BackgroundBrowsers();
  observeBrowser(page);
  secureBrowserSession(page.session);
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/`;
    page.session.webRequest.onBeforeRequest((details, done) => done({ cancel: !details.url.startsWith(url) }));
    await page.loadURL(url);
    const snapshot = await browserSnapshot(target);
    assert(snapshot.ok, snapshot.detail);
    assert(!JSON.stringify(snapshot).includes("password-never-in-snapshot"));
    const data = snapshot.data as { snapshotId: string; elements: Array<{ ref: number; label: string; type?: string }> };
    const ref = (label: string) => ({ snapshotId: data.snapshotId, ref: data.elements.find((item) => item.label === label)!.ref });
    // A hostile page cannot swap the private snapshot's refs.
    await page.executeJavaScript("window.__capsuleSnapshot = {id: 'fake', nodes: new Map()}");
    const typed = await callBrowserTool(target, "browser_type", { ...ref("Name"), text: "Quoted '\" ${literal}" });
    assert(typed.ok, typed.detail);
    assert.equal(await page.executeJavaScript("document.querySelector('#result').textContent"), "Quoted '\" ${literal}");
    const clicked = await callBrowserTool(target, "browser_click", ref("Save"));
    assert(clicked.ok, clicked.detail);
    assert.equal(await page.executeJavaScript("document.querySelector('#result').textContent"), "Saved");
    assert(!(await callBrowserTool(target, "browser_click", ref("Disabled"))).ok);
    assert(!(await callBrowserTool(target, "browser_click", ref("Covered"))).ok);
    const password = data.elements.find((item) => item.type === "password")!;
    assert(!(await callBrowserTool(target, "browser_type", { snapshotId: data.snapshotId, ref: password.ref, text: "secret" })).ok);
    assert((await callBrowserTool(target, "browser_select", { ...ref("Choice"), text: "two" })).ok);
    assert.equal(await page.executeJavaScript("document.querySelector('select').value"), "two");
    assert((await callBrowserTool(target, "browser_scroll", { deltaY: 500 })).ok);
    assert(await page.executeJavaScript("scrollY > 0"));
    const image = await browserScreenshot(target);
    assert(image.ok, image.detail);
    assert(image.image?.data && image.image.data.length < 2_000_000);
    // Exercise the native image path without modifying the user's clipboard.
    let copiedImage = false;
    await copyBrowserScreenshot(page, (pixels) => {
      assert(!pixels.isEmpty());
      assert.equal(pixels.toPNG().subarray(1, 4).toString(), "PNG");
      copiedImage = true;
    });
    assert(copiedImage, "Screenshot did not reach the native image clipboard path");
    await browserSnapshot(target);
    assert(!(await callBrowserTool(target, "browser_click", ref("Save"))).ok, "Old snapshot was reused");
    await page.loadURL(url + "next");
    assert(!(await callBrowserTool(target, "browser_click", ref("Save"))).ok, "Navigation reused old refs");
    await page.executeJavaScript("for(let i=0;i<100;i++) console.log('diagnostic '+i)");
    assert.equal(browserDiagnostics(page).length, 80);
    // Large DOM snapshots disclose truncation and retain bounded output.
    await page.executeJavaScript("document.body.replaceChildren(...Array.from({length:6000}, () => { const e=document.createElement('p'); e.textContent='x'.repeat(50); return e; }))");
    const large = await browserSnapshot(target);
    assert((large.data as { truncated: boolean }).truncated);
    assert(Buffer.byteLength(JSON.stringify(large)) < 100_000);
    let backgroundPage = await background.control("thread-a", { kind: "start", url }, "fixture-agent");
    const paintDeadline = Date.now() + 2500;
    while (!backgroundPage.image && Date.now() < paintDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      backgroundPage = await background.inspect("thread-a", false);
    }
    assert(backgroundPage.exists && backgroundPage.image, `Hidden page did not produce a preview: ${JSON.stringify(backgroundPage)}`);
    assert.equal(backgroundPage.agentAllowed, false);
    assert.deepEqual(await background.inspect("thread-a", true), { exists: true, remoteShared: false });
    assert.deepEqual(await background.inspect("thread-b", true), { exists: false });
    assert.throws(() => background.target("thread-a", "fixture-agent")!.contents(), /access is off/);
    await assert.rejects(background.control("thread-a", { kind: "agent", allowed: true }), /Start a direct agent/);
    assert.equal((await background.inspect("thread-a", false)).agentAllowed, false);
    await background.control("thread-a", { kind: "agent", allowed: true }, "fixture-agent");
    const backgroundTarget = background.target("thread-a", "fixture-agent")!;
    assert((await browserSnapshot(backgroundTarget)).ok, "Granted background page was not usable");
    assert.throws(() => background.target("thread-a", "other-agent")!.contents(), /access is off/);
    assert.notEqual(backgroundTarget.contents()!.session, page.session, "Background page reused foreground credentials");
    await background.control("thread-a", { kind: "share", allowed: true });
    const shared = await background.inspect("thread-a", true);
    assert(shared.image && shared.url === url, "Explicit sharing did not expose a snapshot");
    const hiddenContents = backgroundTarget.contents()!;
    const connected = await hiddenContents.executeJavaScript(`new Promise(resolve => {
      const socket = new WebSocket(${JSON.stringify(url.replace("http:", "ws:"))});
      const timer = setTimeout(() => { socket.close(); resolve(false); }, 2000);
      socket.onopen = () => { clearTimeout(timer); socket.close(); resolve(true); };
      socket.onerror = () => { clearTimeout(timer); resolve(false); };
    })`);
    assert(connected, "Background preview blocked its WebSocket connection");
    const hiddenPartition = hiddenContents.session;
    const capturePage = hiddenContents.capturePage.bind(hiddenContents);
    const pixels = await capturePage();
    let finishCapture!: () => void;
    hiddenContents.capturePage = () => new Promise((resolve) => { finishCapture = () => resolve(pixels); });
    background.revokeAgent("thread-a"); // Invalidates the shared frame cache.
    const pendingSharedFrame = background.inspect("thread-a", true);
    assert(finishCapture, "Capture did not start");
    const unsharing = background.control("thread-a", { kind: "share", allowed: false });
    hiddenContents.capturePage = capturePage;
    finishCapture();
    assert.deepEqual(await pendingSharedFrame, { exists: true, remoteShared: false }, "In-flight pixels escaped after sharing was revoked");
    await unsharing;
    assert.deepEqual(await background.inspect("thread-a", true), { exists: true, remoteShared: false });
    background.revokeAgent("thread-a");
    assert.throws(() => backgroundTarget.contents(), /access is off/);
    for (const owner of ["thread-b", "thread-c", "thread-d"]) await background.control(owner, { kind: "start", url });
    await assert.rejects(background.control("thread-e", { kind: "start", url }), /At most four/);
    await assert.rejects(background.control("thread-e", { kind: "start", url: "file:///etc/passwd" }));
    await hiddenPartition.cookies.set({ url, name: "temporary", value: "fixture" });
    background.close("thread-a");
    assert.deepEqual(await background.inspect("thread-a", true), { exists: false });
    assert.throws(() => backgroundTarget.contents(), /access is off/);
    const cleanupDeadline = Date.now() + 2500;
    while ((await hiddenPartition.cookies.get({ url })).length && Date.now() < cleanupDeadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await hiddenPartition.cookies.get({ url })).length, 0, "Closed background profile retained cookies");
    console.log("Browser regressions passed: real page actions, isolation, stale refs, screenshots and bounded diagnostics.");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { clearTimeout(watchdog); background.closeAll(); server.close(); }
});
