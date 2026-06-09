Implement `retryAsync` in `src/retry-async.ts`.

## Expected behavior

`retryAsync(operation, attempts)` runs an async `operation`, retrying it when it
rejects:

- Call `operation()`. If it resolves, return its value immediately.
- If it rejects, try again, up to `attempts` total calls.
- If the final attempt rejects, reject with that last error.
- `attempts` is treated as at least `1` (a value below 1 still runs once).

Examples:

- An operation that rejects once then resolves to `"ok"`, with `attempts = 3`,
  resolves to `"ok"` after 2 calls.
- An operation that always rejects, with `attempts = 2`, rejects after exactly
  2 calls with the last error.
- An operation that resolves on the first call is only called once.

## Constraints

Keep the exported generic signature
`retryAsync<Value>(operation: () => Promise<Value>, attempts: number): Promise<Value>`.
Do not change `src/sync-button.tsx`.
