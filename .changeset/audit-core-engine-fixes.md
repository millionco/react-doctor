---
"@react-doctor/core": patch
---

Engine fixes from a 20-day audit of recent changes

- The binary-split retry budget for failed oxlint batches is now anchored at
  the first splittable failure instead of at pass start, so a batch that first
  fails late in a long lint pass still gets split down to the pathological file
  instead of being dropped whole.
- `REACT_DOCTOR_SUPPLY_CHAIN_TIMEOUT_MS` can now actually raise the
  supply-chain budget: the configured value is threaded into the check's inner
  wall-clock cap, which previously stayed pinned at the 90s constant.
- The derived `fixGroupId` no longer rides the Score API payload, keeping the
  request shape identical to what the server has always received.
- `compute-ruleset-hash.ts` no longer contains literal NUL bytes (they're now
  `\u0000` escapes — byte-identical hashes), so git and code search treat the
  cache-invalidation file as text instead of binary.
