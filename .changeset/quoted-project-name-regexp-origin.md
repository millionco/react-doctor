---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Detect unescaped regular expressions built from quoted Gradle project names forwarded through replacement descriptors. Preserve authored regex patterns and unsupported source routes.

Refresh whole-scan cache entries when indexed production sources or resolver dependencies change, including ignored files. Skip reuse when the dependency snapshot is incomplete.

Index repeated quoted-name caller proofs once per resolver generation and replay their dependency probes on cache hits.

Build source-module scope analyses only when a rule needs them so dependency fingerprints avoid unused semantic work.

Reuse complete dependency proofs across whole-scan cache lookups after freshly checking their source membership and file contents. Rebuild proofs when their inputs or toolchain change.
