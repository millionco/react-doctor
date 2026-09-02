---
"react-doctor": patch
---

Accept multiple file paths as positional arguments. Allows CI to pass a pre-computed changed-file list directly instead of re-deriving it via `--scope files --base`.

Usage:
- `react-doctor src/a.tsx src/b.tsx` - scans specific files
- `react-doctor` - scans current directory (backward compatible)
- `react-doctor ./apps/web` - scans specific directory (backward compatible)
