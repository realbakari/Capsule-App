// A hidden, isolated renderer for DOM regression tests. It never loads Capsule's profile.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) => {
    done({ cancel: /^https?:/i.test(details.url) });
  });
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
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
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
