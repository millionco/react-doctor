---
"react-doctor": patch
---

Change agent hook default timing from `PostToolBatch`/`postToolUse` to `Stop`/`stop` for better performance and token efficiency. Agent hooks now run once when the agent finishes responding instead of after every tool batch or tool use, reducing scan frequency and improving UX on long sessions with many uncommitted files.
