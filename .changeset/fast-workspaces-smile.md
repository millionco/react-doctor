---
"react-doctor": patch
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Keep large workspace scans responsive by reducing TUI redraws, cooperatively enumerating source files, reusing repository cache fingerprints across workspace projects, avoiding nested-project rescans, capping automatic lint parallelism before its contention cliff, enforcing scan deadlines on active subprocesses, preserving partial security findings and listing queued projects skipped at the deadline, terminating every subprocess on cancellation, suppressing bundled Browserslist maintenance warnings, and bounding recursive helper analysis.
