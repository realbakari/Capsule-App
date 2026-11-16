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
  const { renderPublicPages, SITE } = createRequire(import.meta.url)(bundle);
  // The site is dark like the app, so the page keeps the dark ground it starts with.
  const shell = (await readFile(path.join(out, "index.html"), "utf8")).replaceAll('src="./', 'src="/').replaceAll('href="./', 'href="/');
  const pages = renderPublicPages();
  for (const page of pages) {
    const html = shell.replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)} · Capsule</title>`)
      .replace(/(<meta name="description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*("\s*\/?>)/, `$1${escape(page.title)} · Capsule$2`)
      .replace(/(<meta property="og:description" content=")[^"]*("\s*\/?>)/, `$1${escape(page.description)}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*("\s*\/?>)/, `$1${SITE}/${page.slug}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*("\s*\/?>)/, `$1${SITE}/${page.slug}$2`)
      .replace(/(<meta property="og:image" content=")[^"]*("\s*\/?>)/, `$1${SITE}/icon.png$2`)
      .replace('<div id="root"></div>', () => `<div id="root">${page.html}</div>`)
      .replace(/<noscript>[\s\S]*?<\/noscript>/, "");
    const directory = path.join(out, page.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "index.html"), html);
  }
  // Search engines find every page on the site's own domain.
  const urls = [`${SITE}/`, ...pages.map((page) => `${SITE}/${page.slug}`)];
  await writeFile(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escape(url)}</loc></url>`).join("\n")}\n</urlset>\n`);
  await writeFile(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Built ${pages.length} public pages with shared navigation and metadata, a sitemap and robots.txt for ${SITE}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
