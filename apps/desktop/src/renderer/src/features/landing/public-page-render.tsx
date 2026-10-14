import { renderToString } from "react-dom/server";
import { PublicPage } from "./PublicPage";
import { PolicyPage } from "./PolicyPage";
import { PUBLIC_PAGES } from "./site-content";
import { POLICY_PAGES } from "./policies.generated";

export function renderPublicPages() {
  return [
    ...PUBLIC_PAGES.map((page) => ({ ...page, html: renderToString(<PublicPage slug={page.slug} />) })),
    ...POLICY_PAGES.map((page) => ({ slug: page.slug, title: page.title, description: `${page.title} for Capsule, a desktop workspace for coding agents.`, html: renderToString(<PolicyPage slug={page.slug} />) })),
  ];
}
