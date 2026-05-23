/**
 * Test helper that silences every `Console.*` Effect (and the
 * `cliLogger` façade) for the duration of a single test. Effect's
 * `Console` module resolves to `globalThis.console` by default, so
 * monkey-patching the global is enough to mute the entire
 * pipeline — every renderer, every CLI helper. Returns a restore
 * function the caller should run in `afterEach`.
 */
export const silenceConsoleForTest = (): (() => void) => {
  const consoleObject = globalThis.console as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const noop = (): void => {};
  for (const key of ["log", "error", "warn", "info", "debug", "trace"]) {
    originals.set(key, consoleObject[key]);
    consoleObject[key] = noop;
  }
  return () => {
    for (const [key, original] of originals) {
      consoleObject[key] = original;
    }
  };
};
