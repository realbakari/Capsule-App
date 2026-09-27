// DOM-only checks against the real public entry point, in an isolated profile.
const { app, BrowserWindow, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

app.whenReady().then(async () => {
  const root = process.argv.find((arg) => arg.startsWith("--showcase-root="))?.slice("--showcase-root=".length);
  if (!root) throw new Error("Missing showcase fixture");
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const name = pathname === "/" || ["/privacy", "/security", "/terms"].includes(pathname) ? "index.html" : pathname.slice(1);
    const file = path.resolve(root, name);
    if (!file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const publicFile = name === "icon.png" ? path.resolve("apps/desktop/src/renderer/public/icon.png") : file;
    try {
      const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" }[path.extname(publicFile)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(publicFile));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.webRequest.onBeforeRequest((details, done) => done({ cancel: /^https?:/.test(details.url) && !details.url.startsWith(`${origin}/`) }));
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const errors = [];
  window.webContents.on("console-message", (_event, level, message) => { if (level === 3) errors.push(message); });
  async function evaluate(script) { return window.webContents.executeJavaScript(script); }
  async function capture(name) {
    const destination = process.env.CAPSULE_SHOWCASE_SCREENSHOTS;
    if (!destination) return;
    fs.mkdirSync(destination, { recursive: true });
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(destination, `${name}.png`), screenshot.toPNG());
  }
  async function waitFor(expression) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Showcase did not become ready: ${expression}\n${errors.join("\n")}`);
  }
  try {
    await window.loadURL(origin);
    await waitFor("Boolean(document.querySelector('.site-preview'))");
    assert.match(await evaluate("document.title"), /Your coding agents/);
    assert.match(await evaluate("document.querySelector('meta[name=description]').content"), /review diffs/);
    assert.match(await evaluate("document.querySelector('meta[property=\"og:image\"]').content"), /^https:\/\//);
    assert.equal(await evaluate("document.querySelectorAll('main h1').length"), 1);
    assert.equal(await evaluate("[...document.querySelectorAll('.site a[href^=\"#\"]')].every(a => document.querySelector(a.getAttribute('href')))"), true);
    const downloads = await evaluate("[...document.querySelectorAll('.site-download-grid a[class]')].map(a => a.href)");
    assert.equal(downloads.length, 2);
    assert.match(downloads[0], /\/releases\/download\/v0\.7\.0\/Capsule-0\.7\.0-arm64\.dmg$/);
    assert.match(downloads[1], /\/releases\/download\/v0\.7\.0\/Capsule-0\.7\.0-x64-setup\.exe$/);
    await evaluate("document.querySelector('.site-preview').scrollIntoView()");
    // A lazy iframe can have a document without a body while navigation starts.
    await waitFor("document.querySelector('.site-preview')?.contentDocument?.body?.textContent?.includes('Two columns were reserved')");
    await capture("public-desktop-preview");
    await evaluate("document.querySelector('.site').scrollTo({top:0,behavior:'instant'})");
    await capture("public-desktop");
    assert.equal(await evaluate("Boolean(document.querySelector('.app'))"), false, "Desktop shell leaked into marketing document");
    assert.equal(await evaluate("document.querySelector('.site-preview').contentDocument.querySelector('.showcase-preview').inert"), true);
    assert.equal(await evaluate("document.querySelectorAll('footer a[href=\"/privacy\"]').length"), 1);
    // Renderer-only operations must not pretend to succeed in the sample bridge.
    assert.match(await evaluate("window.capsule.sendMessage({}).then(() => 'unexpected success', error => error.message)"), /sample workspace/);
    window.setContentSize(390, 844);
    await waitFor("!document.querySelector('.site-preview')");
    assert.equal(await evaluate("Boolean(document.querySelector('.site-compact-preview'))"), true);
    assert.match(await evaluate("document.querySelector('.site-compact-preview').textContent"), /not a live agent session/);
    await evaluate("document.querySelector('.site').scrollTo({top:0,behavior:'instant'})");
    await capture("public-mobile");
    assert.equal(await evaluate("document.querySelector('.site').scrollWidth <= innerWidth"), true, "Mobile page overflows horizontally");
    await evaluate("document.querySelector('.site-compact-preview').scrollIntoView({behavior:'instant'})");
    await capture("public-mobile-preview");
    await evaluate("document.querySelector('.site-nav a[href=\"#download\"]').click()");
    await waitFor("location.hash === '#download' && document.querySelector('#download').getBoundingClientRect().top < innerHeight");
    await capture("public-downloads");
    await evaluate("document.querySelector('.site-source summary').click()");
    assert.equal(await evaluate("document.querySelector('.site-source').open"), true);
    await evaluate("document.querySelector('.site-copy').click()");
    await waitFor("document.querySelector('.site-source [role=status]').textContent !== 'The command downloads dependencies and starts the desktop app.'");
    assert.equal(await evaluate("document.querySelector('.site').scrollWidth <= innerWidth"), true, "Expanded source command overflows mobile");
    window.setContentSize(320, 740);
    assert.equal(await evaluate("document.querySelector('.site').scrollWidth <= innerWidth"), true, "Narrow mobile page overflows");
    window.setContentSize(1440, 1000);
    await waitFor("Boolean(document.querySelector('.site-preview'))");
    assert.equal(await evaluate("Boolean(document.querySelector('.site-compact-preview'))"), false);
    for (const slug of ["privacy", "security", "terms"]) {
      await window.loadURL(`${origin}/${slug}`);
      await waitFor("Boolean(document.querySelector('.policy-body h2'))");
      assert.equal(await evaluate("Boolean(document.querySelector('.app'))"), false);
    }
    assert.deepEqual(errors, []);
    console.log("Showcase regressions passed");
    server.close();
    app.exit(0);
  } catch (error) {
    console.error(error, errors);
    server.close();
    app.exit(1);
  }
});
