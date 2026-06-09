// Resolve how to spawn a CLI entry. A bare command name (e.g. `react-doctor`)
// is invoked directly so the OS resolves it on PATH; a `.js`/`.mjs` file path
// is run through the current Node binary so it works without an executable bit
// (the common case when pointing at a monorepo's built `bin/*.js` in dev).
export const resolveBinInvocation = (
  bin: string,
): { command: string; prefixArgs: string[] } => {
  if (/\.[mc]?js$/.test(bin)) {
    return { command: process.execPath, prefixArgs: [bin] };
  }
  return { command: bin, prefixArgs: [] };
};
