---
"react-doctor": patch
---

Fix mojibake (`ÔÇö`, `├ù`) in CLI output on Windows. The console was decoding
react-doctor's UTF-8 bytes with a non-UTF-8 code page (CP-850/437 in cmd.exe),
so `—`, `×`, `›`, and box-drawing rendered as garbage — including in VS Code's
terminal. Switch the Windows console to UTF-8 (code page 65001) once at CLI
startup (console-only, best-effort), which fixes every glyph at the source
rather than swapping individual characters for ASCII. Closes #956.
