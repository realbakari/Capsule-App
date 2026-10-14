import { POLICY_PAGES } from "./policies.generated";
import "./landing.css";
import { SiteShell } from "./SiteShell";

/*
 * A public page — privacy, security, terms — on the website.
 *
 * The words come from the Markdown at the repository root, converted at build
 * time, so the page and the file someone reads in the source cannot disagree.
 * The HTML is ours, generated from our own files by our own converter, which
 * escapes everything it does not recognise.
 */

export function policyForPath(pathname: string): (typeof POLICY_PAGES)[number] | undefined {
  const slug = pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  return POLICY_PAGES.find((page) => page.slug === slug);
}

export function PolicyPage({ slug }: { slug: string }) {
  const page = POLICY_PAGES.find((item) => item.slug === slug);
  if (!page) return null;
  const html = page.html.replace(/^<h2>(.*?)<\/h2>/, "<h1>$1</h1>");
  return (
    <SiteShell current={`/${slug}`}><div className="policy-page">
      <header className="policy-head">
        <a className="policy-home" href="/">
          ← Capsule
        </a>
        <nav className="policy-nav">
          {POLICY_PAGES.map((item) => (
            <a
              key={item.slug}
              href={`/${item.slug}`}
              className={item.slug === slug ? "current" : undefined}
            >
              {item.title}
            </a>
          ))}
        </nav>
      </header>
      <article className="policy-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div></SiteShell>
  );
}
