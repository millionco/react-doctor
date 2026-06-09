Implement the typed `localStorage` helpers in `src/storage.ts`.

## Expected behavior

Both functions use the global `localStorage` API (`localStorage.getItem`,
`setItem`).

- `readJson<Value>(key, fallback)` reads `key`, JSON-parses it, and returns the
  value typed as `Value`. It returns `fallback` when the key is absent
  (`getItem` returns `null`) **or** when the stored string is not valid JSON.
  It must never throw.
- `writeJson<Value>(key, value)` serializes `value` with `JSON.stringify` and
  stores it under `key`.

Round-trip: after `writeJson("k", { a: 1 })`, `readJson("k", null)` returns
`{ a: 1 }`.

## Constraints

Keep the generic signatures `readJson<Value>(key: string, fallback: Value)` and
`writeJson<Value>(key: string, value: Value)`. Do not change
`src/theme-store.ts`.
