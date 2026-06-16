---
"react-doctor": patch
---

Stop recommending the deprecated `--diff` flag in agent-facing guidance (#834).

The CLI "Agent guidance" section, the installed agent hooks, and the `--help` examples all advised running `react-doctor --verbose --diff`, which now prints a deprecation warning on every run. They now recommend the supported `--scope changed` (pass `--base <ref>` to pin the base). The website `llms.txt` and the `react-doctor` skill reference were updated to match.
