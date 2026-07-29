---
"@react-doctor/core": patch
---

Fix suppression comments being ignored when invisible Unicode characters are present at line ends. When `TERMINAL_EMULATOR=JetBrains-JediTerm` is set or similar IDE/terminal configurations, zero-width spaces and other invisible characters can break `react-doctor-disable-next-line` and `react-doctor-disable-line` comments. The regex patterns now explicitly match these characters.
