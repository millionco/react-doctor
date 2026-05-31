---
"react-doctor": patch
---

Diagnostic ranking now depends solely on the score API's per-rule priority. The hand-rolled severity/category-stakes weighting (and the offline priority midpoints) is gone: when the API priority is unavailable (`--no-score`, offline, or API failure) rules and categories keep their scan order, with categories falling back to alphabetical for determinism.
