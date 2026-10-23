/** JSONB round trips reorder object keys. Decision comparisons must compare values, not serialization order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, canonical(entry)]));
  return value ?? null;
}

export const sameJsonValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
