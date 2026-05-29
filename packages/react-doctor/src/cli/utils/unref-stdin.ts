// HACK: react-doctor is a one-shot CLI, but Node keeps the event loop
// alive for as long as `process.stdin` (fd 0) is an open pipe or
// socket — even though the only thing that ever reads stdin is an
// interactive prompt. When the CLI is spawned by a parent that holds
// the stdin write-end open (eval runners, CI harnesses, editor
// integrations), the scan finishes and the `--json` report flushes,
// yet the process never exits: the inherited `Socket fd=0` refs the
// loop. Some Node versions / stdin fd types ref the socket merely on
// access (the bundled `import process from "node:process"` facade
// materializes the lazy `process.stdin` getter), so the hang is not
// always reproducible, but unref-ing up front makes an idle stdin
// incapable of holding the process open in every case.
//
// Interactive prompts are unaffected: `prompts` builds a
// `readline.createInterface({ input: process.stdin })`, whose
// `resume()` (and `setRawMode(true)` on a TTY) re-refs stdin for the
// lifetime of the prompt and releases it on close.
//
// File / `/dev/null` stdin resolves to an `fs.ReadStream` that has no
// `unref` (and never holds the loop open anyway), hence the optional
// call.
export const unrefStdin = (): void => {
  process.stdin.unref?.();
};
