#!/usr/bin/env node
/*
 * The public pages, built from the files that are the actual policy.
 *
 * Privacy, security and terms live as Markdown at the repository root, because
 * that is where someone reading the source looks for them and where their
 * history is legible. The website needs the same words — so it gets them from
 * the same files, converted at build time, rather than a second copy in a
 * component that drifts the first time one is amended.
 *
 * The converter handles only what these documents use. Anything it does not
 * recognise is escaped and shown as text, which is the safe direction to fail.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PAGES = [
  { slug: "privacy", file: "PRIVACY.md", title: "Privacy" },
  { slug: "security", file: "SECURITY.md", title: "Security" },
  { slug: "terms", file: "TERMS.md", title: "Terms of use" },
];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Inline: code spans, bold, italic, links, and bare autolinks. */
export function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // [text](href) — only http(s) and in-repo relative links.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    if (/^https?:\/\//.test(href)) {
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    }
    if (/^[A-Za-z0-9._/-]+$/.test(href)) {
      return `<a href="https://github.com/realbakari/Capsule-App/blob/main/${href}">${label}</a>`;
    }
    return whole;
  });
  // <https://…> autolinks, after escaping has turned the brackets into entities.
  out = out.replace(
    /&lt;(https?:\/\/[^\s&]+)&gt;/g,
    (_, href) => `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`,
  );
  return out;
}

function tableRow(line) {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function toHtml(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let index = 0;
  let list = null;

  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      out.push("<hr />");
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // A table: a header row, a divider, then rows.
    if (trimmed.startsWith("|") && (lines[index + 1] ?? "").trim().startsWith("|-")) {
      closeList();
      const headers = tableRow(trimmed);
      index += 2;
      const rows = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        rows.push(tableRow(lines[index].trim()));
        index += 1;
      }
      out.push(
        `<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
      );
      continue;
    }

    if (trimmed.startsWith("```")) {
      closeList();
      index += 1;
      const code = [];
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(escapeHtml(lines[index] ?? ""));
        index += 1;
      }
      index += 1;
      out.push(`<pre><code>${code.join("\n")}</code></pre>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      index += 1;
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      index += 1;
      continue;
    }

    // A paragraph runs until a blank line; Markdown's single newlines are not
    // breaks, so they are joined with a space.
    closeList();
    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }

  closeList();
  return out.join("\n");
}

function isBlockStart(line) {
  const trimmed = line.trim();
  return (
    /^#{1,6}\s/.test(trimmed) ||
    /^[-*]\s/.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    trimmed.startsWith("|") ||
    trimmed.startsWith("```") ||
    /^(-{3,}|\*{3,})$/.test(trimmed)
  );
}

function build() {
  const pages = PAGES.map((page) => ({
    slug: page.slug,
    title: page.title,
    html: toHtml(readFileSync(path.join(root, page.file), "utf8")),
  }));

  const target = path.join(root, "apps/desktop/src/renderer/src/features/landing");
  mkdirSync(target, { recursive: true });
  const body = `/*
 * Generated by scripts/build-policy-pages.mjs from PRIVACY.md, SECURITY.md and
 * TERMS.md. Edit those, not this file.
 */

export interface PolicyPage {
  slug: string;
  title: string;
  html: string;
}

export const POLICY_PAGES: PolicyPage[] = ${JSON.stringify(pages, null, 2)};
`;
  writeFileSync(path.join(target, "policies.generated.ts"), body, "utf8");
  console.log(`Built ${pages.length} policy pages`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build();
}
