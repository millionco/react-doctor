---
"react-doctor": patch
---

Add `--warning-exit-code <code>` for non-blocking warnings, including GitLab CI jobs that use `allow_failure.exit_codes`. Accept integers from 2 to 255. Preserve existing blocking rules, CI surface filters, and default exit codes across text, JSON, and interactive reports.
