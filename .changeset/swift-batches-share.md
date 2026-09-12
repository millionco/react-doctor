---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Speed up scans without changing any diagnostic: lint batches are planned for every pooled oxlint worker, sidecar cache probes are interned into a per-bucket table (a 27 MB cache file becomes about 1 MB), source files are listed once per scan, workers import the rule plugin while they boot, cross-file targets are parsed with oxc raw transfer, and the whole-repo cache identity resolves its git calls concurrently.
