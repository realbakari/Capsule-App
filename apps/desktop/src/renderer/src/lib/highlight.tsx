import { Fragment, type ReactNode } from "react";
import { createLowlight } from "lowlight";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Explicit languages keep the bundle and work bounded. Never guess a language
// by running every grammar over arbitrary agent output.
const highlighter = createLowlight({ bash, css, diff, go, ini, javascript, json, python, rust, sql, typescript, xml, yaml });
highlighter.registerAlias({ javascript: ["jsx"], typescript: ["tsx"], bash: ["shell", "zsh"] });
const MAX_HIGHLIGHT_CHARS = 20_000;
const CACHE_LIMIT = 24;
const cache = new Map<string, ReactNode>();
type HighlightNode = ReturnType<typeof highlighter.highlight>["children"][number];

const TOKEN_CLASSES: Record<string, string> = {
  "hljs-keyword": "tok-kw", "hljs-literal": "tok-kw",
  "hljs-string": "tok-str", "hljs-regexp": "tok-str",
  "hljs-comment": "tok-com", "hljs-quote": "tok-com",
  "hljs-number": "tok-num", "hljs-symbol": "tok-num",
  "hljs-title": "tok-title", "hljs-built_in": "tok-title",
  "hljs-type": "tok-type", "hljs-name": "tok-type", "hljs-selector-tag": "tok-type",
  "hljs-attr": "tok-attr", "hljs-attribute": "tok-attr", "hljs-selector-id": "tok-attr", "hljs-selector-class": "tok-attr",
  "hljs-addition": "tok-add", "hljs-deletion": "tok-del",
};

/** Only text and our own spans reach React; highlighted HTML is never injected. */
function renderTokens(nodes: HighlightNode[], depth = 0): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "text") return node.value;
    if (node.type !== "element") return null;
    const scopes = Array.isArray(node.properties.className) ? node.properties.className : [];
    const className = scopes.map((scope) => TOKEN_CLASSES[String(scope)]).filter(Boolean).join(" ") || undefined;
    // Grammars produce shallow spans. Avoid adding arbitrary DOM depth if a
    // future grammar emits excessive nesting; the underlying text stays intact.
    const children = renderTokens(node.children, depth + 1);
    return depth < 32 && className
      ? <span className={className} key={index}>{children}</span>
      : <Fragment key={index}>{children}</Fragment>;
  });
}

export function clearHighlightCache(): void { cache.clear(); }

export function highlight(code: string, language?: string): ReactNode {
  const lang = language?.toLowerCase();
  if (!lang || code.length > MAX_HIGHLIGHT_CHARS || !highlighter.registered(lang)) return code;
  const key = `${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let result: ReactNode;
  try { result = renderTokens(highlighter.highlight(lang, code).children); }
  catch { result = code; }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
