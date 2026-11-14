import { memo } from "react";
import { highlight } from "../../lib/highlight";
import { CopyButton } from "./CopyButton";
import { HtmlPreviewButton } from "./HtmlPreview";

// Unchanged fences retain their DOM and copy state as later text arrives.
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const html = /^html?$/i.test(language ?? "");
  return (
    <div className="msg-code-wrap">
      <div className="msg-code-bar">
        <span className="msg-code-lang">{language || "code"}</span>
        <span className="md-diagram-tools">
          {html && code.trim() && <HtmlPreviewButton html={code} />}
          <CopyButton text={code} label="Copy code" />
        </span>
      </div>
      <pre className="msg-code" tabIndex={0} aria-label={`${language || "Plain text"} code`}>
        {highlight(code, language)}
      </pre>
    </div>
  );
});
