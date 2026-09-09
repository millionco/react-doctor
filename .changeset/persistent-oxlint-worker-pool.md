---
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Speed up large-repository scans: reuse warm oxlint worker processes across projects, overlap project discovery with linting, and trim rule hot paths (2.4–5.5x faster wall-clock on the large-repo corpus).
