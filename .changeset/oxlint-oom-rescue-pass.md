---
"@react-doctor/core": patch
"react-doctor": patch
---

Rescue oxlint OOM-dropped files with a serial replay instead of reporting a partial scan. When a parallel lint pass drops files because oxlint's native binding SIGABRT'd under memory pressure (oxc's fixed-size allocator panics when N concurrent oxlint processes compete for memory on very large packages), those files are now replayed once, serially, one single-file batch each — the memory pressure is usually a function of sibling processes, not the file itself, so the replay typically completes the scan. Only files that still fail alone stay dropped and reported.
