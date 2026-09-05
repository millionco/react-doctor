---
"oxlint-plugin-react-doctor": patch
---

Fix an `async-defer-await` false positive on exact `live` and `isLive` liveness guards without exempting unrelated names that only contain the same text.
