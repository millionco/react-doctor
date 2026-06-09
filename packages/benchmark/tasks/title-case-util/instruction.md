Implement `titleCase` in `src/title-case.ts`.

## Expected behavior

`titleCase(input)` capitalizes the first letter of each word and lowercases the
rest:

- Words are separated by single spaces in the output; collapse any run of
  whitespace in the input to a single space and trim the ends.
- For each word, uppercase the first character and lowercase the remaining
  characters.
- An empty (or whitespace-only) input returns `""`.

Examples:

- `titleCase("hello world")` → `"Hello World"`
- `titleCase("  the QUICK  brown  ")` → `"The Quick Brown"`
- `titleCase("ALL CAPS")` → `"All Caps"`
- `titleCase("")` → `""`

## Constraints

Keep the exported `titleCase(input: string): string` signature. Do not change
`src/section-heading.tsx`.
