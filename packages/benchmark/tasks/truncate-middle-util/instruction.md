Implement `truncateMiddle` in `src/truncate-middle.ts`.

## Expected behavior

`truncateMiddle(text, maxLength)` shortens long text by removing the middle and
inserting a single `…` (U+2026) so the **total result length equals
`maxLength`**.

- If `text.length <= maxLength`, return `text` unchanged.
- Otherwise keep the start and end of `text` around a single `…`. The ellipsis
  counts as one character toward `maxLength`. When the remaining character
  budget is odd, give the extra character to the **front**.
- If `maxLength <= 1`, return `"…"`.

Examples:

- `truncateMiddle("hello", 10)` → `"hello"`
- `truncateMiddle("hello world", 7)` → `"hel…rld"`
- `truncateMiddle("abcdefgh", 5)` → `"ab…gh"`
- `truncateMiddle("anything", 1)` → `"…"`

## Constraints

Keep the exported `truncateMiddle(text: string, maxLength: number): string`
signature. Do not change `src/file-chip.tsx`.
