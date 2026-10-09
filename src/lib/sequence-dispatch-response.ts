/** Only an explicit invalid-number refusal proves a send did not happen. */
export function isDefinitiveInvalidNumber(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (response.ok !== false || Number(response.status) !== 400) return false;
  const rejected = (part: unknown, depth = 0): boolean => {
    if (depth > 8 || part == null) return false;
    if (typeof part === "string") {
      try { return rejected(JSON.parse(part), depth + 1); } catch { return false; }
    }
    if (typeof part !== "object") return false;
    if (Array.isArray(part)) return part.some((item) => rejected(item, depth + 1));
    const object = part as Record<string, unknown>;
    return object.exists === false || Object.values(object).some((item) => rejected(item, depth + 1));
  };
  return rejected(response.error);
}