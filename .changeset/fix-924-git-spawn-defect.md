---
"react-doctor": patch
"@react-doctor/core": patch
---

Stop a scan from crashing when a git subprocess fails synchronously (fixes REACT-DOCTOR-1E, REACT-DOCTOR-1P, REACT-DOCTOR-20). Unlike a missing binary (`ENOENT`, which arrives on the catchable `'error'` event), `child_process.spawn` **throws synchronously** when the working directory isn't a directory (`ENOTDIR`) or the argument list exceeds the OS command-line limit (`ENAMETOOLONG` — e.g. `--scope lines` on a 1,000+-file diff on Windows). That throw escaped Effect's error channel entirely and took down the whole scan (reported to Sentry as a raw `spawn` error). The git runner now pre-flights both conditions and fails on its normal channel, so the existing fallbacks recover instead: a bad working directory degrades like an unavailable git, and an over-long `--scope lines` diff degrades to file-level scope.
