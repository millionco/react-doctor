---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

Speed up scans without changing any diagnostic: lint batches are planned for every pooled oxlint worker, sidecar cache probes are interned into a per-bucket table (a 27 MB cache file becomes about 2.5 MB) and collected by the idle pool workers instead of the parent thread, source files are listed once per scan and shared with the duplicate-JSX pass, workers import the rule plugin while they boot, cross-file targets are parsed with oxc raw transfer, the whole-repo cache identity resolves its git calls concurrently, and TypeScript, conf, prompts and agent-install load on first use instead of at startup.
