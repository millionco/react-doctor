// Split a `className` string into its whitespace-separated classes, each
// reduced to its base utility — the segment after any variant prefixes
// (`hover:`, `md:`, `group-data-open:`). So `md:hover:transition-all` → the
// base `transition-all`, while `transition-all-custom` stays distinct. This is
// the token-accurate way to test for a specific Tailwind utility (vs a regex
// that can match a substring inside a larger class name).
export const getClassNameTokens = (classNameValue: string): string[] =>
  classNameValue
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => token.split(":").pop() ?? token);
