---
"react-doctor": patch
---

Fix `Dead code detection failed (non-fatal, skipping)` (#135). The plugin-failure detector now walks the error cause chain, matches Windows-style paths, plugin configs without a leading directory, and parser errors, so knip plugin loading errors are recovered from in more environments. The retry loop also now surfaces the original knip error after exhausting attempts (previously could throw a generic `Unreachable` error) and only disables knip plugin keys it actually recognizes. Dead-code and lint failures are now reported with the full cause chain instead of a single wrapped `Error loading …` line.
