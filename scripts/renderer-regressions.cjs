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
    const result = await window.webContents.executeJavaScript("window.runRendererRegressions().then(value => ({ value }), error => ({ error: String(error.stack || error) }))");
    if (result.error) throw new Error(result.error);
    console.log(result.value);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
