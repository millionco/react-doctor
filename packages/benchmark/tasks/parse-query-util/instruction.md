Implement `parseQuery` in `src/parse-query.ts`.

## Expected behavior

`parseQuery(search)` parses a URL query string into a plain object.

- An optional leading `?` is ignored.
- Pairs are separated by `&`; key and value are separated by `=`.
- Keys and values are URI-decoded (`%20` → space, `+` is left as-is is **not**
  required — use `decodeURIComponent`).
- A key with no `=` maps to an empty string.
- When a key repeats, the **last** occurrence wins.
- An empty string (or just `"?"`) returns `{}`.

Examples:

- `parseQuery("?a=1&b=two")` → `{ a: "1", b: "two" }`
- `parseQuery("name=Ada%20Lovelace")` → `{ name: "Ada Lovelace" }`
- `parseQuery("flag&x=1")` → `{ flag: "", x: "1" }`
- `parseQuery("k=1&k=2")` → `{ k: "2" }`
- `parseQuery("")` → `{}`

## Constraints

Keep the exported `parseQuery(search: string): Record<string, string>`
signature. Do not change `src/filter-summary.tsx`.
