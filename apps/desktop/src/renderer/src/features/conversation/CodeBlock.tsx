import { memo, useState } from "react";
import { highlight } from "../../lib/highlight";
import { fenceText, terminalCommandFrom } from "../../lib/shell-command";
import { CopyButton } from "./CopyButton";
import { HtmlPreviewButton } from "./HtmlPreview";

// Unchanged fences retain their DOM and copy state as later text arrives.
export const CodeBlock = memo(function CodeBlock({ code, language, closed = true, onTypeCommand }: {
  code: string;
  language?: string;
  closed?: boolean;
  /** Types a command into a fresh terminal for the person to run. Absent where there is no terminal. */
  onTypeCommand?: (command: string) => void;
}) {
  const html = /^html?$/i.test(language ?? "");
  const text = fenceText(code);
  const [wrap, setWrap] = useState(true);
  const command = onTypeCommand ? terminalCommandFrom(code, language, closed) : undefined;
  return (
    <div className="msg-code-wrap">
      <div className="msg-code-bar">
        <span className="msg-code-lang">{language}</span>
        <span className="md-diagram-tools">
          {html && code.trim() && <HtmlPreviewButton html={code} />}
          {command && <button type="button" className="md-media-button" title="Type this command into a new terminal. Press Return there to run it."
            onClick={() => onTypeCommand?.(command)}>Type in terminal</button>}
          <button type="button" className="md-media-button" aria-pressed={wrap} title={wrap ? "Show long lines unwrapped" : "Wrap long lines"}
            onClick={() => setWrap((value) => !value)}>Wrap</button>
          <CopyButton text={text} label="Copy code" />
        </span>
      </div>
      <pre className="msg-code" data-wrap={wrap ? undefined : "false"} tabIndex={0} aria-label={`${language || "Plain text"} code`}>
        {highlight(text, language)}
      </pre>
    </div>
  );
});
