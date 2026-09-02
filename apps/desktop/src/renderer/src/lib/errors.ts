/*
 * Errors reach the renderer wrapped by the layers they crossed. Electron adds
 * the channel it was invoked on, the Gateway adds an ACP code, and OpenClaw
 * appends operator advice about slash commands nobody types in Capsule. What
 * is left after all of it is usually one sentence from the provider, and that
 * sentence is the only part the reader can act on.
 */

/** `Error invoking remote method 'capsule:sendMessage': Error: …` */
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/u;
const ERROR_PREFIX = /^(?:[A-Za-z]*Error):\s*/u;
/** `ACP error (ACP_SESSION_INIT_FAILED): …` and `AcpRuntimeError [ACP_X]: …` */
const ACP_CODE = /^(?:ACP error \(([A-Z_]+)\)|[A-Za-z]*Error \[([A-Z_]+)\]):\s*/u;
/** OpenClaw's own remediation, written for someone at the Gateway console. */
const OPERATOR_HINT = /\s*\bnext:\s.*$/su;

/** Names a bare ACP code when the provider sent no message of its own. */
function readableCode(code: string): string {
  const words = code.replace(/^ACP_/u, "").toLowerCase().replaceAll("_", " ");
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : "The agent reported an error.";
}

/** The part of a failure worth showing someone. */
export function formatUserError(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? "");
  let text = raw.trim();
  let code: string | undefined;

  // Peel one wrapper at a time: a message can carry several.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    text = text.replace(IPC_WRAPPER, "");
    const acp = ACP_CODE.exec(text);
    if (acp) {
      code = acp[1] ?? acp[2] ?? code;
      text = text.slice(acp[0].length);
    } else {
      text = text.replace(ERROR_PREFIX, "");
    }
    if (text === before) break;
  }

  text = text.replace(OPERATOR_HINT, "").replace(/\s+/gu, " ").trim();
  if (text) return text;
  return code ? readableCode(code) : raw.trim() || "Something went wrong.";
}
