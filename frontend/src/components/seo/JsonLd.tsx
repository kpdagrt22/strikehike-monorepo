/**
 * One JSON-LD block, rendered by the page that owns it (json-ld.md). `<` is escaped to <, so
 * no payload string can close the script element. A data block, not executable code.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
