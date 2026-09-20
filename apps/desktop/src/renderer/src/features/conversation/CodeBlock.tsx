import { memo } from "react";
import { highlight } from "../../lib/highlight";
import { CopyButton } from "./CopyButton";

// Unchanged fences retain their DOM and copy state as later text arrives.
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <div className="msg-code-wrap">
      <div className="msg-code-bar">
        <span className="msg-code-lang">{language || "code"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <pre className="msg-code" tabIndex={0} aria-label={`${language || "Plain text"} code`}>
        {highlight(code, language)}
      </pre>
    </div>
  );
});
