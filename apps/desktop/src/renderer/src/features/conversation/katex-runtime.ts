import "katex/dist/katex.min.css";
import katex from "katex";

export function renderTex(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", maxExpand: 500, output: "htmlAndMathml" });
}
