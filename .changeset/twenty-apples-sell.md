---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Detect native `Reflect.set` writes to React refs during render, tracking an explicit React-ref receiver as the write destination and preserving predictable guarded initialization. Keep erased TypeScript declarations from hiding native namespace values while respecting runtime shadows and unknown ambient function providers, including declarations in namespaces.
