// HACK: react-doctor is a one-shot CLI, but when stdin (fd 0) is an
// inherited pipe or socket Node keeps the event loop alive for as long
// as that handle is open — even though the only thing that ever reads
// stdin is an interactive prompt. When the CLI is spawned by a parent
// that holds the stdin write-end open (eval runners, CI harnesses,
// editor integrations), the scan finishes and the `--json` report
// flushes, yet the process never exits: the inherited `Socket fd=0`
// refs the loop. Unref-ing fd 0 up front makes an idle pipe/socket
// incapable of holding the process open.
//
// We MUST NOT unref an interactive TTY. A real terminal is the only
// case that shows prompts, and `prompts` never re-refs an unref'd stdin
// handle: its base element does `readline.createInterface(...)` +
// `setRawMode(true)` but never `resume()`, and none of those re-ref the
// libuv handle (verified on a real PTY). Unref-ing a TTY therefore lets
// the event loop drain while a prompt is still waiting for input — the
// CLI renders the prompt and then exits by itself (code 0) before the
// user can answer. A TTY is never the "parent holds the pipe open"
// hang scenario, so guarding on `isTTY` keeps the one-shot exit fix
// without breaking interactive prompts.
//
// File / `/dev/null` stdin resolves to an `fs.ReadStream` that has no
// `unref` (and never holds the loop open anyway), hence the optional
// call.
export const unrefStdin = (): void => {
  if (process.stdin.isTTY) return;
  process.stdin.unref?.();
};
