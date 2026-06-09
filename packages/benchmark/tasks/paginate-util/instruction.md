Implement `paginate` in `src/paginate.ts`.

## Expected behavior

`paginate(items, page, perPage)` returns the slice for a 1-indexed page plus
pagination metadata.

- `perPage` is coerced to at least `1`.
- `totalItems` is the input length; `totalPages` is
  `ceil(totalItems / perPage)`, but at least `1` (an empty list still has one
  empty page).
- `page` is clamped to the range `[1, totalPages]`.
- `items` is the slice for the clamped page.

Returns `{ items, page, perPage, totalItems, totalPages }` where `page` and
`perPage` are the clamped/coerced values actually used.

Examples (with `perPage = 2`):

- `paginate([1,2,3,4,5], 1, 2)` → items `[1,2]`, page 1, totalPages 3, totalItems 5
- `paginate([1,2,3,4,5], 3, 2)` → items `[5]`, page 3
- `paginate([1,2,3,4,5], 99, 2)` → items `[5]`, page 3 (clamped)
- `paginate([], 1, 2)` → items `[]`, page 1, totalPages 1, totalItems 0

## Constraints

Keep the exported generic signature
`paginate<Item>(items: readonly Item[], page: number, perPage: number): Page<Item>`.
Do not change `src/results-view.tsx`.
