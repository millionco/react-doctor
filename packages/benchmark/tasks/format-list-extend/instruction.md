`src/format-list.ts` joins a list of strings into a sentence. Extend it.

## Expected behavior

Change `formatList` to take an options object as its second argument:
`formatList(items, options?)` where `options` is
`{ conjunction?: string; oxford?: boolean }`.

- `conjunction` defaults to `"and"`.
- Existing joining behavior is unchanged by default:
  - `formatList([])` → `""`
  - `formatList(["a"])` → `"a"`
  - `formatList(["a", "b"])` → `"a and b"`
  - `formatList(["a", "b", "c"])` → `"a, b and c"`
- New: when `options.oxford` is `true` and there are 3+ items, place a comma
  before the conjunction (the Oxford comma):
  - `formatList(["a", "b", "c"], { oxford: true })` → `"a, b, and c"`
- `conjunction` still applies:
  - `formatList(["a", "b", "c"], { conjunction: "or" })` → `"a, b or c"`

## Constraints

Export `formatList` with the new `(items: string[], options?) => string`
signature. Do not change `src/attendees-label.tsx` (it calls `formatList(names)`).
