---
"oxlint-plugin-react-doctor": patch
---

New rule `no-stale-timer-ref` (State & Effects, warn): flags `clearTimeout(ref.current)` / `clearInterval(ref.current)` on a `useRef`-held timer id that is never reset afterwards, in components that read `ref.current` truthiness as a "timer pending" signal. Clearing cancels the callback but leaves the old id in the ref, so pending guards keep treating a cancelled timer as live — re-arming dismissed work or skipping future scheduling. The clear-then-null and clear-then-re-arm (debounce) shapes, bare `if (ref.current) clearTimeout(ref.current)` guard idioms, and effect-cleanup returns stay unflagged.
