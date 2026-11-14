import { memo, useEffect, useState } from "react";
import "./markdown-media.css";

type Renderer = (tex: string, display: boolean) => string;

let renderer: Renderer | undefined;
let loading: Promise<Renderer> | undefined;
/* Replies re-render per token; a formula is typeset once per text. */
const typeset = new Map<string, { html: string } | { error: string }>();

function loadRenderer(): Promise<Renderer> {
  loading ??= import("./katex-runtime").then((module) => (renderer = module.renderTex));
  return loading;
}

function typesetTex(render: Renderer, tex: string, display: boolean) {
  const key = `${display ? "D" : "I"}${tex}`;
  let entry = typeset.get(key);
  if (!entry) {
    try { entry = { html: render(tex, display) }; }
    catch (error) { entry = { error: (error instanceof Error ? error.message : String(error)).replace(/^KaTeX parse error:\s*/, "").split("\n")[0]!.slice(0, 160) }; }
    if (typeset.size > 400) typeset.delete(typeset.keys().next().value!);
    typeset.set(key, entry);
  }
  return entry;
}

/** TeX shows as source until the typesetter loads, and stays source when it cannot parse. */
export const MathTex = memo(function MathTex({ tex, display }: { tex: string; display: boolean }) {
  const [render, setRender] = useState<Renderer | undefined>(() => renderer);
  useEffect(() => {
    if (render) return;
    let live = true;
    void loadRenderer().then((next) => { if (live) setRender(() => next); }, () => undefined);
    return () => { live = false; };
  }, [render]);
  const result = render ? typesetTex(render, tex, display) : undefined;
  const Tag = display ? "div" : "span";
  if (result && "html" in result) {
    return <Tag className={display ? "md-math md-math--block" : "md-math"} dangerouslySetInnerHTML={{ __html: result.html }} />;
  }
  return <Tag className={`md-math-source${display ? " md-math-source--block" : ""}`} title={result?.error ? `Could not typeset: ${result.error}` : undefined}>
    {display ? `$$\n${tex}\n$$` : `$${tex}$`}
  </Tag>;
});
