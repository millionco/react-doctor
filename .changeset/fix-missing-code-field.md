---
"@react-doctor/core": patch
---

Fix crash when oxlint diagnostic has no code field. Some diagnostics (like parse errors) omit the code field, causing parseRuleCode to throw "Cannot read properties of undefined (reading 'match')". parseRuleCode now returns { plugin: "unknown", rule: "unknown" } when code is missing.
