import type { ReactNode } from "react";
import { REPO } from "./site-content";
import "./landing.css";

const NAVIGATION = [
  { href: "/features", label: "Features" }, { href: "/about", label: "Story" },
  { href: "/updates", label: "Updates" }, { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
];

export function SiteHeader({ current = "/" }: { current?: string }) {
  const links = NAVIGATION.map(({ href, label }) => <a key={href} href={href} aria-current={current === href ? "page" : undefined}>{label}</a>);
  return <header className="site-bar">
    <a className="site-mark" href="/"><img src="/icon.png" alt="" width={22} height={22} />Capsule</a>
    <nav className="site-nav" aria-label="Main navigation">{links}</nav>
    <a className="site-header-download" href="/#download">Get Capsule <span aria-hidden="true">↗</span></a>
    <details className="site-mobile-nav"><summary>Explore Capsule</summary><nav aria-label="Mobile navigation">{links}<a href="/faq">FAQ</a><a href="/support">Support</a></nav></details>
  </header>;
}

export function SiteFooter() {
  return <footer className="site-footer">
    <div><a className="site-mark" href="/">Capsule</a><p>A workspace for the work you make.</p><span>Open source · MIT license</span></div>
    <nav aria-label="Footer">
      <div><span>Product</span><a href="/features">Features</a><a href="/about">Story</a><a href="/pricing">Pricing</a><a href="/#download">Download</a></div>
      <div><span>Explore</span><a href="/resources">Guides</a><a href="/updates">Updates</a><a href="/roadmap">Development</a><a href={REPO}>Source code ↗</a></div>
      <div><span>Help</span><a href="/faq">FAQ</a><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/security">Security</a><a href="/terms">Terms</a></div>
    </nav>
  </footer>;
}

export function SiteShell({ children, current }: { children: ReactNode; current?: string }) {
  return <div className="site"><a className="site-skip" href="#product">Skip to content</a><SiteHeader current={current} /><main id="product" tabIndex={-1}>{children}</main><SiteFooter /></div>;
}
