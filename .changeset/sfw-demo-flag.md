---
"react-doctor": minor
---

Add a `--sfw` demo flag that prints the Socket.dev supply-chain score (0–100) of every direct dependency — across every workspace `package.json` in a monorepo, de-duplicated by `name@version` — color-coded and sorted worst-first, then exits without running a scan. Scores come from Socket's free, keyless PURL endpoint (the same one the supply-chain check uses).
