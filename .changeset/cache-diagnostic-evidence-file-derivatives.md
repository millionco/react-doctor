---
"react-doctor": patch
---

Reuse file line splits and UTF-8 buffers when reading evidence for multiple diagnostics.

Load diagnostic evidence syntax only for forwarded-handler analysis, and avoid repeated suppression scans in source snapshots without disable directives.

Reuse per-file UTF-8 newline indexes when resolving diagnostic span lines.
