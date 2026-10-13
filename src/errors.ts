export function resolveServerMessage(data: unknown, fallback: string): string {
  if (typeof data === "string") {
    return data.trim() || fallback;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return fallback;
  }

  const map = data as Record<string, unknown>;
  const raw = map.errorMsg ?? map.msg ?? map.message;
  const text = String(raw || "").trim();
  return text || fallback;
}
