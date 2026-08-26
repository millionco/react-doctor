---
"@react-doctor/core": patch
---

Fix audit mode file corruption after ungraceful process termination. When `neutralizeDisableDirectives` mutates user source files in audit mode (replace inline disable directives), the restoration now survives SIGKILL, power loss, terminal crashes, and OOM killer events through a self-healing backup system. Backup files (`.react-doctor-backup`) are written before each mutation and automatically restored on next startup if an ungraceful exit prevented the normal restoration hook from running.
