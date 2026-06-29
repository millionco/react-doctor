---
"react-doctor": patch
---

Show staged findings in the pre-commit hook instead of swallowing them

The generated pre-commit hook captured react-doctor's output to a temp file and
deleted it before printing, so a failing scan showed only a generic "found
staged regressions" notice — never the actual findings (#969). The hook now
writes the scan output to stderr before cleanup, in both the raw hook and the
hook-manager command. It stays non-blocking by design (the commit still
proceeds); the diagnostics are simply visible now so you know what to fix.
