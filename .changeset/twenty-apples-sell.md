---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Detect native `Reflect.set` writes to React refs during render, tracking an explicit React-ref receiver as the write destination and preserving predictable guarded initialization. Keep erased TypeScript declarations from hiding native namespace values while respecting runtime shadows and unknown runtime providers, including merged namespace exports and global augmentations.

Native aliases may use lexical const bindings and ordinary ES-module exports. Variables exported from TypeScript namespaces remain outside the proof because they emit mutable namespace properties.

Reuse indexed scope lookups and avoid revisiting absent namespace export groups during native-provider checks.
