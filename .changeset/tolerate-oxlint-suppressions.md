---
"@react-doctor/core": patch
---

Fix lint failure when project has oxlint-suppressions.json

React Doctor now tolerates oxlint's summary diagnostics about suppressions file mismatches instead of treating them as parse errors. When a project has its own `oxlint-suppressions.json` file, oxlint emits diagnostics like "There are suppressions that do not occur anymore." or "There are new violations not covered by the suppressions file." These diagnostics have empty filenames and are now silently filtered out rather than causing the entire lint pass to fail with "Failed to parse oxlint output."
