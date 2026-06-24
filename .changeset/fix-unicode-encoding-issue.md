---
"react-doctor": patch
---

Fix encoding issue with Unicode characters on Windows. Replace multiplication sign (×) and em dash (—) with ASCII fallbacks (x and -) when Unicode is not supported by the terminal, preventing garbled output on Windows systems without UTF-8 console encoding.
