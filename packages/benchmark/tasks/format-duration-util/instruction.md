Implement `formatDuration` in `src/format-duration.ts`.

## Expected behavior

`formatDuration(milliseconds)` returns a compact human label built from hours,
minutes, and seconds (sub-second precision is dropped via truncation).

- Units are space-separated, largest first, suffixed `h` / `m` / `s`:
  `formatDuration(3_661_000)` → `"1h 1m 1s"`.
- Leading zero units are omitted, but lower units after a non-zero unit are
  kept: `formatDuration(3_600_000)` → `"1h"`, `formatDuration(3_601_000)` →
  `"1h 0m 1s"`.
- Under a minute returns just seconds: `formatDuration(5_000)` → `"5s"`.
- Zero (and any negative input) returns `"0s"`.

Examples:

- `formatDuration(0)` → `"0s"`
- `formatDuration(65_000)` → `"1m 5s"`
- `formatDuration(-10)` → `"0s"`

## Constraints

Keep the exported `formatDuration(milliseconds: number): string` signature. Do
not change `src/elapsed-label.tsx`.
