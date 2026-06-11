import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type { Diagnostic } from "@react-doctor/core";
import { highlighter } from "@react-doctor/core";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

// Writes the full diagnostics dump and prints its location when the user
// asked for it (`--output-dir`) or is in verbose mode. Failing to write the
// dump shouldn't block rendering — v4 forbids try/catch inside Effect.gen,
// so the sync write is wrapped in `Effect.try` (always-tagged form) and
// recovered via `Effect.orElseSucceed`.
export const printDiagnosticsDump = (
  diagnostics: Diagnostic[],
  outputDirectory: string | null | undefined,
  verbose: boolean | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const writtenDirectory = yield* Effect.try({
      try: () => writeDiagnosticsDirectory(diagnostics, outputDirectory),
      catch: (cause) => cause,
    }).pipe(Effect.orElseSucceed(() => null as string | null));
    if (writtenDirectory !== null && (Boolean(verbose) || Boolean(outputDirectory))) {
      yield* Console.log(highlighter.gray(`  Full diagnostics written to ${writtenDirectory}`));
    }
  });
