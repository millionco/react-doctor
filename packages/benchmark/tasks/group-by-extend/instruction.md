`src/group-by.ts` groups a list of records by a property name. Extend it.

## Expected behavior

`groupBy(items, key)` must support **two** forms of `key`:

1. A **property name** (existing behavior): `groupBy(items, "category")` groups
   by `item.category`.
2. A **selector function**: `groupBy(items, (item) => …)` groups by the value the
   function returns for each item.

In both cases the result is an object mapping each distinct key (as a string) to
the array of items that produced it, in first-seen order. Existing callers that
pass a property name must keep working unchanged.

Examples:

- `groupBy([{ t: "a" }, { t: "b" }, { t: "a" }], "t")` →
  `{ a: [{ t: "a" }, { t: "a" }], b: [{ t: "b" }] }`
- `groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? "even" : "odd"))` →
  `{ odd: [1, 3], even: [2, 4] }`

## Constraints

Keep the export named `groupBy`. Do not change `src/inventory-report.ts`.
