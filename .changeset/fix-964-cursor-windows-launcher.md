---
"react-doctor": patch
---

Fix Cursor agent handoff on Windows. Cursor installs its CLI as a PowerShell-wrapped `.cmd` that Node's `spawn()` cannot execute without `shell: true` (which would mangle the multi-line handoff prompt). The launcher now resolves Cursor's bundled `node.exe` + `index.js` under `%LOCALAPPDATA%\cursor-agent\versions\<latest>\` and spawns it directly — preserving argv integrity and bypassing the PowerShell hop. Closes #964.
