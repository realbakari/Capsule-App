export const modelFavoriteKey = (agentId: string, modelId: string) => JSON.stringify([agentId, modelId]);
export function readModelFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("capsule.model-favorites") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length <= 8192).slice(-100) : [];
  } catch { return []; }
}
