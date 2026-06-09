Implement `chunkize` in `src/chunk.ts`.

## Expected behavior

`chunkize(items, size)` splits an array into consecutive chunks of length
`size`:

- The final chunk holds the remainder and may be shorter.
- If `size` is greater than or equal to the length, return a single chunk with
  every item.
- An empty input returns `[]`.
- If `size` is less than 1, return `[]`.

Examples:

- `chunkize([1, 2, 3, 4, 5], 2)` → `[[1, 2], [3, 4], [5]]`
- `chunkize(["a", "b", "c"], 5)` → `[["a", "b", "c"]]`
- `chunkize([], 3)` → `[]`
- `chunkize([1, 2], 0)` → `[]`

## Constraints

Keep the exported generic signature
`chunkize<Item>(items: readonly Item[], size: number): Item[][]`. Do not change
`src/photo-grid.tsx`.
