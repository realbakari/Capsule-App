// A hidden, isolated renderer for DOM regression tests. It never loads Capsule's profile.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    done({ cancel: /^https?:/i.test(details.url) });
  });
  // Hidden Windows windows receive roughly one animation frame per second,
  // even with backgroundThrottling disabled. Layout assertions need an actual
  // displayed frame source; this test owns its window and disposable profile.
  const window = new BrowserWindow({ show: process.platform === "win32", webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (_event, ...details) => console.log("Renderer:", ...details));
  try {
    const bundlePath = process.argv.find((arg) => arg.startsWith("--renderer-test-bundle="))?.slice("--renderer-test-bundle=".length);
    if (!bundlePath) throw new Error("Missing renderer test bundle");
    await window.loadFile(path.join(path.dirname(bundlePath), "index.html"));
    await window.webContents.executeJavaScript(fs.readFileSync(bundlePath, "utf8"));
    // Hosted macOS runners can request reduced motion. Exercise both settings
    // in the real CSS engine without changing the machine's accessibility prefs.
    window.webContents.debugger.attach("1.3");
    for (const motion of ["reduce", "no-preference"]) {
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] });
      const result = await window.webContents.executeJavaScript(`window.runPetRegressions(${JSON.stringify(motion)}).then(value => ({ value }), error => ({ error: String(error.stack || error) }))`);
      if (result.error) throw new Error(result.error);
      console.log(result.value);
    }
    const result = await window.webContents.executeJavaScript("window.runRendererRegressions().then(value => ({ value }), error => ({ error: String(error.stack || error) }))");
    if (result.error) throw new Error(result.error);
    console.log(result.value);
    const screenshots = process.env.CAPSULE_RENDERER_SCREENSHOTS_DIRECTORY;
    if (screenshots) {
      fs.mkdirSync(screenshots, { recursive: true });
      window.setContentSize(1000, 500);
      for (const resting of [false, true]) {
        await window.webContents.executeJavaScript(`window.renderComposerPreview(${resting})`);
        const bounds = await window.webContents.executeJavaScript("(() => { const r = document.querySelector('.composer').getBoundingClientRect(); return {x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height)}; })()");
        const capture = await window.webContents.capturePage(bounds);
        fs.writeFileSync(path.join(screenshots, resting ? "composer-compact.png" : "composer-expanded.png"), capture.toPNG());
      }
      window.setContentSize(1000, 650);
      for (const [width, openFile, name] of [[420, false, "files-narrow-tree"], [420, true, "files-narrow-preview"], [800, false, "files-split"]]) {
        await window.webContents.executeJavaScript(`window.renderFilesPreview(${width}, ${openFile})`);
        const bounds = await window.webContents.executeJavaScript("(() => { const r = document.querySelector('.codex-inspector').getBoundingClientRect(); return {x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height)}; })()");
        const capture = await window.webContents.capturePage(bounds);
        fs.writeFileSync(path.join(screenshots, `${name}.png`), capture.toPNG());
      }
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
