export type SearchQuery = Record<string, string | string[] | undefined>;

/** Native GET forms submit empty controls as ""; optional filters use undefined. */
export function emptyQueryValuesToUndefined(input: SearchQuery): SearchQuery {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === "" ? undefined : value]));
}
