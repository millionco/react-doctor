Implement `slugify` in `src/slugify.ts`.

## Expected behavior

`slugify(input)` turns arbitrary text into a URL slug:

- Lowercase the whole string.
- Trim leading/trailing whitespace.
- Replace any run of whitespace with a single hyphen.
- Remove every character that is not `a–z`, `0–9`, or `-`.
- Collapse runs of multiple hyphens into one.
- Strip leading and trailing hyphens.

Examples:

- `slugify("Hello, World!")` → `"hello-world"`
- `slugify("  Multiple   Spaces  ")` → `"multiple-spaces"`
- `slugify("Café & Crème")` → `"caf-crme"`
- `slugify("--already--slugged--")` → `"already-slugged"`
- `slugify("")` → `""`

## Constraints

Keep the exported `slugify(input: string): string` signature. Do not change
`src/article-link.tsx`.
