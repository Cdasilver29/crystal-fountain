/**
 * One JSON-LD block.
 *
 * A script tag written with dangerouslySetInnerHTML, which is how JSON-LD has
 * to be emitted: React escapes text children, and an escaped &quot; in a
 * ld+json block is not parseable JSON.
 *
 * Everything passed in comes from src/content and src/lib/structured-data, so
 * none of it is user input. The escaping below is there anyway, because the
 * one sequence that matters is cheap to close and expensive to notice later.
 * A closing script tag appearing inside a JSON string ends the block early as
 * far as the HTML parser is concerned, whatever the JSON says, so every "<" is
 * written as a unicode escape. That parses back to exactly the same string,
 * and it can no longer close the tag it sits in.
 */
export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
