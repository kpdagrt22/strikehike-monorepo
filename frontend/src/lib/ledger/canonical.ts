// Browser twin of backend/src/astro_finance/ledger/canonical.py and
// frontend/scripts/ledger-verify.mjs. The shared vector proves the bytes.
export function canonicalJson(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("non-integer numbers are not allowed");
    }
    return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new TypeError(`unsupported value: ${typeof value}`);
}

export async function ledgerHash(entry: Record<string, unknown>): Promise<string> {
  const payload = { ...entry };
  delete payload.hash;
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
