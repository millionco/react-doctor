---
"react-doctor": patch
---

Guard the startup `process.stdin` unref on `process.stdin.isTTY` so interactive prompts no longer exit by themselves. The startup unref (added so one-shot non-interactive runs like `--json` from an eval runner holding the stdin pipe open can exit cleanly) was applied unconditionally, including on a real terminal. On a TTY `prompts` never re-refs the unref'd stdin handle — `readline.createInterface` + `setRawMode(true)` do not re-ref it — so the multiselect ("Select projects") rendered and the CLI then drained the event loop and exited (code 0) before the user could answer. Skipping the unref when stdin is a TTY keeps the one-shot exit fix for non-interactive pipes/sockets while leaving interactive terminals untouched. Adds an in-process behavioral test and a real-PTY CI smoke (`pnpm smoke:tty-prompt`).
