import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "apps/desktop/out/renderer");
const temporary = await mkdtemp(path.join(tmpdir(), "capsule-public-pages-"));
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
try {
  const bundle = path.join(temporary, "pages.cjs");
  await build({ entryPoints: [path.join(root, "apps/desktop/src/renderer/src/features/landing/public-page-render.tsx")], outfile: bundle, bundle: true, platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' } });
  const { renderPublicPages } = createRequire(import.meta.url)(bundle);
  const shell = (await readFile(path.join(out, "index.html"), "utf8")).replaceAll('src="./', 'src="/').replaceAll('href="./', 'href="/').replace('data-theme="dark"', 'data-theme="light"');
  const pages = renderPublicPages();
  for (const page of pages) {
    const html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)} · Capsule</title>`)
      .replace(/(<meta name="description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*("\s*\/?>)/, `$1${escape(page.title)} · Capsule$2`)
      .replace(/(<meta property="og:description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace('<div id="root"></div>', () => `<div id="root">${page.html}</div>`)
      .replace(/<noscript>[\s\S]*?<\/noscript>/, "");
    const directory = path.join(out, page.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), html);
  }
  console.log(`Built ${pages.length} public pages with shared navigation and metadata`);
} finally { await rm(temporary, { recursive: true, force: true }); }
