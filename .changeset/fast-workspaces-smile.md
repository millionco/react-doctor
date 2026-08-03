---
"react-doctor": patch
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Keep large workspace scans responsive by reducing TUI redraws, cooperatively enumerating source files, reusing those listings for configured ignores, reusing repository cache fingerprints across workspace projects, avoiding nested-project rescans, capping automatic lint parallelism before its contention cliff, enforcing scan deadlines on active subprocesses, preserving partial security findings without marking disabled passes incomplete, listing queued projects skipped at the deadline, showing every incomplete-result warning, terminating every subprocess on cancellation, suppressing bundled Browserslist maintenance warnings, memoizing module-resolution filesystem probes, path-compressing config lookup walks, bounding recursive helper analysis, indexing repeated class-member lookups, and visiting each alias binding once.
