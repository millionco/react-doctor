---
"oxlint-plugin-react-doctor": patch
---

Keep `no-derived-state` quiet for a closed cache that stores an async payload together with its request key and hides the payload until that key matches the current request. Preserve warnings for ordinary derived copies and unsupported cache or identity relationships.
