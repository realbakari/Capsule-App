import type { ReactNode } from "react";
import { DOCS, RELEASE, REPO } from "./site-content";
import "./landing.css";

const NAVIGATION = [
  { href: "/features", label: "Features" },
  { href: "/resources", label: "Guides" },
  { href: "/updates", label: "Changelog" },
  { href: "/pricing", label: "Pricing" },
];

function Chevron() {
  return <svg className="site-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** The arrow on a text link; it moves on hover, so the link reads as going somewhere. */
export function Arrow({ external = false }: { external?: boolean }) {
  return <svg className={`site-arrow${external ? " is-external" : ""}`} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d={external ? "M5 11l6-6M6 5h5v5" : "M3 8h9M8.5 4.5 12 8l-3.5 3.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function SiteHeader({ current = "/" }: { current?: string }) {
  const links = NAVIGATION.map(({ href, label }) => <a key={href} href={href} aria-current={current === href ? "page" : undefined}>{label}</a>);
  return <header className="site-bar">
    <div className="site-bar-inner">
      <a className="site-mark" href="/"><img src="/icon.png" alt="" width={22} height={22} />Capsule</a>
      <nav className="site-nav" aria-label="Main navigation">{links}</nav>
      <div className="site-bar-actions">
        <a className="site-bar-link" href={REPO}>Source</a>
        <a className="site-header-download" href="/#download">Download</a>
      </div>
      <details className="site-mobile-nav">
        <summary aria-label="Menu"><span>Menu</span><Chevron /></summary>
        <nav aria-label="Mobile navigation">{links}<a href="/faq">Questions</a><a href="/support">Support</a><a href={REPO}>Source code</a></nav>
      </details>
    </div>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-brand">
        <a className="site-mark" href="/"><img src="/icon.png" alt="" width={20} height={20} />Capsule</a>
        <p>A desktop workspace for coding agents. Free and open source under the MIT license.</p>
        <p className="site-footer-version">Version {RELEASE}</p>
      </div>
      <nav aria-label="Footer">
        <div><h2>Product</h2><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/updates">Changelog</a><a href="/roadmap">Roadmap</a><a href="/#download">Download</a></div>
        <div><h2>Learn</h2><a href="/resources">Guides</a><a href="/faq">Questions</a><a href="/about">About</a><a href={`${DOCS}/getting-started.md`}>Getting started</a></div>
        <div><h2>Project</h2><a href={REPO}>Source code</a><a href={`${REPO}/issues`}>Issues</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/security">Security</a><a href="/terms">Terms</a></div>
      </nav>
    </div>
  </footer>;
}

export function SiteShell({ children, current }: { children: ReactNode; current?: string }) {
  return <div className="site"><a className="site-skip" href="#product">Skip to content</a><SiteHeader current={current} /><main id="product" tabIndex={-1}>{children}</main><SiteFooter /></div>;
}
