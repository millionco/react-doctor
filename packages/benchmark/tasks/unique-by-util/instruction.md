Implement `uniqueBy` in `src/unique-by.ts`.

## Expected behavior

`uniqueBy(items, selector)` removes duplicate items, where two items are
duplicates when `selector` returns an equal key (compared with `Set`/`Map`
equality, i.e. `===`).

- Keep the **first** item for each distinct key.
- Preserve the original order of the kept items.
- An empty input returns `[]`.

Examples:

- `uniqueBy([{ id: 1, t: "a" }, { id: 2, t: "b" }, { id: 3, t: "a" }], (x) => x.t)`
  → `[{ id: 1, t: "a" }, { id: 2, t: "b" }]`
- `uniqueBy([1, 1, 2, 3, 2], (n) => n)` → `[1, 2, 3]`

## Constraints

Keep the exported generic signature
`uniqueBy<Item, Key>(items: readonly Item[], selector: (item: Item) => Key): Item[]`.
Do not change `src/tag-list.tsx`.
