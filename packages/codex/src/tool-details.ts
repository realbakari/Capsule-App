import { readToolActivityDetails, type ToolActivityDetails } from "@capsule/shared";
import { object } from "./transport.js";

/** Keep displayable operation facts; never stringify binary or opaque provider output. */
export function nativeToolDetails(item: Record<string, unknown>): ToolActivityDetails {
  if (item.type === "commandExecution") return readToolActivityDetails({
    rawInput: item.command, rawOutput: item.aggregatedOutput,
  });
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    const changes = item.changes.slice(0, 8).map(object);
    return readToolActivityDetails({
      locations: changes,
      rawOutput: changes.flatMap((change) => typeof change.diff === "string" ? [change.diff.slice(0, 2049)] : []).join("\n"),
      payloadTruncated: item.changes.length > 8,
    });
  }
  if (item.type === "mcpToolCall") {
    const result = object(item.result);
    const error = object(item.error);
    const content = Array.isArray(result.content) ? result.content : undefined;
    return readToolActivityDetails({
      content: typeof error.message === "string" ? undefined : content?.slice(0, 32).map((content) => ({ type: "content", content })),
      rawOutput: typeof error.message === "string" ? error.message : undefined,
      payloadTruncated: content !== undefined && content.length > 32,
    });
  }
  return {};
}
