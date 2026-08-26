---
"react-doctor": patch
---

Remove oxlint/oxc packages from `minimumReleaseAgeExclude` to restore the 2-hour release quarantine for these third-party dependencies. Oxlint/oxc is the core analysis engine where a compromised or bad release has maximal impact. The exclusion was removing the one guard that protects that path.
