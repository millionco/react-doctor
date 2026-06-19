---
"react-doctor": patch
---

Overlap the Socket.dev supply-chain check with the lint pass. The supply-chain
score lookup is ~100% network-bound and the lint pass is ~100% CPU/subprocess-
bound, but they previously ran back-to-back. The check now runs on a background
fiber whose wall-clock overlaps the lint pass, collapsing the two serial phases
into roughly `max(supplyChain, lint)`. A generous wall-clock budget bounds a
hung network socket so it can never drag out a scan; on expiry the check fails
open to no diagnostics — the same outcome as an existing Socket API outage. The
diagnostic set, ordering, and score are unchanged.
