---
"react-doctor": minor
---

Add a `react-doctor debug` subcommand that starts an NDJSON logging server for evidence-based debugging. It supports an interactive mode, a `--daemon` mode (spawns a detached background server and prints one JSON line), and a `--json` mode, and is idempotent via a singleton lock file so re-running returns the existing session. The bundled `react-doctor` agent skill gains `/debug` (a runtime-instrumentation root-cause loop) and `/performance` (a LoAF + commit attribution rig) sections that drive this server.
