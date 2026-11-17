import { CodeBlock } from "./CodeBlock";
import { MathTex } from "./MathTex";
import { MermaidBlock } from "./MermaidBlock";

/** A fence whose language has a richer view: diagrams and formulas draw once the fence is closed. */
export function FencedCode({ code, language, closed, onTypeCommand }: { code: string; language?: string; closed: boolean; onTypeCommand?: (command: string) => void }) {
  const kind = language?.toLowerCase();
  if (kind === "mermaid") return <MermaidBlock code={code} closed={closed} />;
  if (kind === "math" && closed && code.trim()) return <MathTex tex={code.trim()} display />;
  return <CodeBlock code={code} language={language} closed={closed} onTypeCommand={onTypeCommand} />;
}
