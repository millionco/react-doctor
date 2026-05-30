---
"react-doctor": patch
---

Fix the CLI hanging after the post-scan prompts. Interactive prompts re-ref stdin via `readline` and never release it on close, undoing the startup `unrefStdin()` and holding the one-shot CLI's event loop open. The shared `prompts` wrapper now re-unrefs stdin once each prompt settles.
