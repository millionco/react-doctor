---
"react-doctor": patch
---

Ship anonymized diagnostic snippets to telemetry. When Sentry tracing is enabled, each scan now emits a small, deduplicated, capped sample of the structural shapes that rules fire on — identifiers and literals are blinded, only the AST structure is preserved — as child spans of the run trace. No real source, names, paths, or literals leave the machine, and the pass is a no-op when telemetry is off.
