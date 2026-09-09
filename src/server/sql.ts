/**
 * Small SQL helpers shared by the services.
 *
 * Plain functions with no database handle and no Next imports.
 */

/**
 * Escapes a term going into a LIKE pattern.
 *
 * Without this a search for "100%" matches every row, because the percent is
 * read as the wildcard rather than as a character somebody typed. Backslash is
 * escaped first, or it would go on to escape the escapes added after it.
 *
 * The pattern this produces must be used with `escape '\\'`, which is what
 * tells Postgres to read the backslashes as escapes rather than as literals.
 *
 * This is not a defence against injection. Every value here is a bound
 * parameter and never string concatenated into SQL. It is about a search term
 * meaning what the person typing it meant.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}
