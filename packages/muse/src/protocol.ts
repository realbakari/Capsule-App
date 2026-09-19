import { sanitizeUntrusted, type AgentPromptBlock, type AcpModelCatalog } from "@capsule/shared";

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Labels may be shortened, but identities sent back to the agent must remain exact. */
export function identifier(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    // Reject protocol identities containing terminal controls or bidi overrides.
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value) ? value : undefined;
}

export function label(value: unknown, fallback: string): string {
  return typeof value === "string" ? sanitizeUntrusted(value, { singleLine: true, maxChars: 200 }) || fallback : fallback;
}

export function museInput(prompt: string | AgentPromptBlock[]): Record<string, unknown>[] {
  const blocks: AgentPromptBlock[] = typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
  if (blocks.length === 0 || blocks.length > 64) throw new Error("Muse needs between one and 64 prompt parts.");
  let size = 0;
  return blocks.map((block) => {
    const value = block.type === "text" ? block.text : block.type === "image" ? block.data : "";
    size += Buffer.byteLength(value, "utf8");
    if (size > 16 * 1024 * 1024) throw new Error("The Muse prompt exceeds the 16 MiB input limit.");
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image" && /^image\/(png|jpeg|webp|gif)$/.test(block.mimeType)
      && /^[A-Za-z0-9+/]+={0,2}$/.test(block.data)) {
      return { type: "image", mediaType: block.mimeType, base64Data: block.data };
    }
    throw new Error("Muse supports text and PNG, JPEG, WebP or GIF images here. Attach other files as workspace references.");
  });
}

export interface MuseModel { modelId: string; name: string; providerId?: string; profileId?: string }
export function readModels(value: unknown): { models: MuseModel[]; catalog: AcpModelCatalog } {
  const rows = object(value).models;
  const models: MuseModel[] = [];
  let currentModelId: string | undefined;
  for (const value of Array.isArray(rows) ? rows.slice(0, 32) : []) {
    const row = object(value);
    const modelId = identifier(row.modelId);
    if (!modelId || models.some((model) => model.modelId === modelId)) continue;
    models.push({ modelId, name: label(row.displayLabel, modelId), providerId: identifier(row.providerId), profileId: identifier(row.profileId) });
    if (row.isActive === true) currentModelId = modelId;
  }
  return { models, catalog: { availableModels: models.map(({ modelId, name }) => ({ modelId, name })), currentModelId } };
}

/** Only an offered, one-time grant can back Capsule's Allow once button. */
export function approvalChoices(value: unknown): { allow?: string; deny?: string } {
  const rows = Array.isArray(value) ? value.slice(0, 32).map(object) : [];
  return {
    allow: identifier(rows.find((row) => row.scope === "once" && row.decision === "approved")?.choiceId),
    deny: identifier(rows.find((row) => row.scope === "once" && (row.decision === "abort" || row.decision === "denied"))?.choiceId),
  };
}
