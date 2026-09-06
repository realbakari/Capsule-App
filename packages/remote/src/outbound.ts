export const MAX_OUTBOUND_BYTES = 8 * 1024 * 1024;

/** RPC replies must fail by ID when oversized, so retry cannot duplicate a write. */
export function outboundFrame(frame: unknown, limit = MAX_OUTBOUND_BYTES): string | undefined {
  const text = JSON.stringify(frame);
  if (Buffer.byteLength(text) <= limit) return text;
  if (frame && typeof frame === "object" && "type" in frame && frame.type === "result" && "id" in frame) {
    return JSON.stringify({ type: "result", id: frame.id, error: "The response is too large for the remote viewer. Open it on the desktop. If this was an action, check its result before retrying." });
  }
  return undefined;
}
