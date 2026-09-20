import { useWorkspace } from "../../lib/workspace";
import { MarkdownBody } from "./MarkdownBody";

export { MarkdownBody } from "./MarkdownBody";

/** Workspace actions stay outside the pure renderer used by review and previews. */
export function MessageBody({ content, githubBaseUrl }: { content: string; githubBaseUrl?: string }) {
  const { openFile, setBrowserUrl, setInspectorOpen, setInspectorTab } = useWorkspace();
  return <MarkdownBody
    content={content}
    githubBaseUrl={githubBaseUrl}
    onOpenFile={openFile}
    onOpenLink={(href) => {
      setBrowserUrl(href);
      setInspectorTab("browser");
      setInspectorOpen(true);
    }}
  />;
}
