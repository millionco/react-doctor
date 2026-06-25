---
"react-doctor": patch
---

Fix Cursor agent handoff on Windows by resolving the bundled node.exe + index.js entry point. Cursor installs its CLI as a PowerShell-wrapped .cmd file that Node's `spawn()` cannot execute without `shell: true` (which would mangle the multi-line handoff prompt). The fix detects Cursor's bundled node under `%LOCALAPPDATA%\cursor-agent\versions\<latest>\` and spawns it directly — preserving argv integrity and bypassing the PowerShell hop. Also adds a shell fallback for other .cmd-based CLIs that don't match the npm-style or Cursor-specific patterns.
