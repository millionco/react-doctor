---
"react-doctor": patch
---

CI setup: collapsed the multi-line inline comments in the generated `.github/workflows/react-doctor.yml` to a single explanatory sentence per trigger and one line for the concurrency block, and dropped the permissions comment (the four well-named keys are self-explanatory). The resulting workflow still configures the same triggers, permissions, and action ref — just with less scrolling for new users.
