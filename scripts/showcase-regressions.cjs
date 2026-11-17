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
    const name = pathname === "/" || ["/privacy", "/security", "/terms", "/features", "/about", "/updates", "/roadmap", "/pricing", "/resources", "/faq", "/support"].includes(pathname) ? "index.html" : pathname.slice(1);
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
    assert.match(await evaluate("document.title"), /desktop workspace for coding agents/);
    assert.match(await evaluate("document.querySelector('meta[name=description]').content"), /review diffs/);
    // The website is dark down to the document, so overscroll and first paint match the page.
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "dark");
    assert.match(await evaluate("document.querySelector('meta[property=\"og:image\"]').content"), /^https:\/\//);
    assert.equal(await evaluate("document.querySelectorAll('main h1').length"), 1);
    assert.equal(await evaluate("[...document.querySelectorAll('.site a[href^=\"#\"]')].every(a => document.querySelector(a.getAttribute('href')))"), true);
    const downloads = await evaluate("[...document.querySelectorAll('.site-download-grid a[class]')].map(a => a.href)");
    assert.equal(downloads.length, 2);
    assert.match(downloads[0], /\/releases\/download\/v0\.15\.0\/Capsule-0\.15\.0-arm64\.dmg$/);
    assert.match(downloads[1], /\/releases\/download\/v0\.15\.0\/Capsule-0\.15\.0-x64-setup\.exe$/);
    await evaluate("document.querySelector('.site-preview').scrollIntoView()");
    // A lazy iframe can have a document without a body while navigation starts.
    await waitFor("Boolean(document.querySelector('.site-preview')?.contentWindow?.capsule?.listProjects)");
    // The sample opens on its first project's first thread, reply and all.
    const sample = await evaluate(`(async () => {
      const bridge = document.querySelector('.site-preview').contentWindow.capsule;
      const projects = await bridge.listProjects();
      const [thread] = await bridge.listSessions(projects[0].id);
      const reply = (await bridge.listMessages(thread.id)).find((message) => message.role === 'assistant');
      const git = await bridge.gitStatus(projects[0].id, thread.id);
      const patches = await Promise.all(git.files.map((file) => bridge.gitScopedDiff(projects[0].id, 'uncommitted', file.path, thread.id)));
      return {
        projects: projects.map((project) => ({ name: project.name, directory: project.workingDirectory })),
        replyStart: reply.content.split('\`')[0].slice(0, 60),
        changed: git.files.length,
        filesWithoutPatch: git.files.filter((file, index) => !patches[index].patch.includes('+++ b/' + file.path)).map((file) => file.path),
      };
    })()`);
    assert.equal(sample.projects.every((project) => project.directory.startsWith("/Users/you/code/") && project.name !== "capsule"), true, `Sample projects are not all made up: ${JSON.stringify(sample.projects)}`);
    assert.ok(sample.changed > 0, "The opened sample thread has no changes to review");
    assert.deepEqual(sample.filesWithoutPatch, [], "A changed file in the sample has no diff of its own");
    await waitFor(`document.querySelector('.site-preview')?.contentDocument?.body?.textContent?.includes(${JSON.stringify(sample.replyStart)})`);
    assert.ok(await evaluate("new Set([...document.querySelector('.site-preview').contentDocument.querySelectorAll('.thread-agent')].map((node) => node.title)).size") >= 2, "The sample sidebar shows only one agent");
    await capture("public-desktop-preview");
    await evaluate("document.querySelector('.site').scrollTo({top:0,behavior:'instant'})");
    await capture("public-desktop");
    assert.equal(await evaluate("Boolean(document.querySelector('.app'))"), false, "Desktop shell leaked into marketing document");
    assert.equal(await evaluate("document.querySelector('.site-preview').contentDocument.querySelector('.showcase-preview').inert"), true);
    // The sample is a picture of the app: no update control in its footer, no pairing advice in its composer.
    assert.equal(await evaluate("Boolean(document.querySelector('.site-preview').contentDocument.querySelector('.update-button'))"), false, "Sample workspace shows an update control");
    assert.equal(await evaluate("[...document.querySelector('.site-preview').contentDocument.querySelectorAll('.composer-preflight')].every(n => n.offsetParent === null)"), true, "Sample workspace shows pairing advice");
    assert.doesNotMatch(await evaluate("document.querySelector('.site-preview').contentDocument.body.textContent"), /Completion not reported/);
    // Laid out at its desktop width and scaled to the column, never squeezed.
    assert.equal(await evaluate("document.querySelector('.site-preview').contentWindow.innerWidth >= 1180"), true, "Sample workspace was laid out narrower than the desktop");
    assert.equal(await evaluate("document.querySelectorAll('footer a[href=\"/privacy\"]').length"), 1);
    // Renderer-only operations must not pretend to succeed in the sample bridge.
    assert.match(await evaluate("window.capsule.sendMessage({}).then(() => 'unexpected success', error => error.message)"), /sample workspace/);
    window.setContentSize(390, 844);
    await waitFor("!document.querySelector('.site-preview')");
    assert.equal(await evaluate("Boolean(document.querySelector('.art-hero'))"), true);
    assert.match(await evaluate("document.querySelector('.art-hero').getAttribute('aria-label')"), /diff/);
    await evaluate("document.querySelector('.site').scrollTo({top:0,behavior:'instant'})");
    await capture("public-mobile");
    assert.equal(await evaluate("document.querySelector('.site').scrollWidth <= innerWidth"), true, "Mobile page overflows horizontally");
    await evaluate("document.querySelector('.art-hero').scrollIntoView({behavior:'instant'})");
    await capture("public-mobile-preview");
    await evaluate("document.querySelector('.site-header-download').click()");
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
    assert.equal(await evaluate("Boolean(document.querySelector('.art-hero'))"), false);
    for (const slug of ["privacy", "security", "terms"]) {
      await window.loadURL(`${origin}/${slug}`);
      await waitFor("Boolean(document.querySelector('.policy-body h1'))");
      assert.equal(await evaluate("Boolean(document.querySelector('.app'))"), false);
      await capture(`public-${slug}`);
    }
    for (const slug of ["features", "about", "updates", "roadmap", "pricing", "resources", "faq", "support"]) {
      await window.loadURL(`${origin}/${slug}`);
      await waitFor("Boolean(document.querySelector('.site-page-heading h1'))");
      assert.equal(await evaluate("document.querySelectorAll('main h1').length"), 1);
      assert.equal(await evaluate("Boolean(document.querySelector('.app'))"), false);
      assert.match(await evaluate("document.title"), /· Capsule$/);
      await capture(`public-${slug}`);
      window.setContentSize(390, 844);
      await waitFor("innerWidth === 390");
      assert.equal(await evaluate("document.querySelector('.site').scrollWidth <= innerWidth"), true, `${slug} overflows mobile`);
      await capture(`public-${slug}-mobile`);
      window.setContentSize(1440, 1000);
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
