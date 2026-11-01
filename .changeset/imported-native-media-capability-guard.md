---
"eslint-plugin-react-doctor": patch
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Recognize directly imported native media capability guards around state updates in effects.

Reuse immutable importer and exporter proofs across effect writes while preserving per-write branch checks, dependency probes, and ordinary module/intrinsic integrity assumptions.

Refresh imported media and captured export proofs when provider files or resolver generations change while retaining the importer analysis.

Replay captured provider and effect probes while reusing immutable media proofs during repeated state-write analysis.
