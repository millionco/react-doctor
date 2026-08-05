import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { isJsonModeActive } from "./json-mode.js";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

export const printDiagnosticsDump = (
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
  verbose?: boolean,
  stream: "stdout" | "stderr" = "stdout",
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const writtenDirectory = yield* Effect.try({
      try: () => writeDiagnosticsDirectory(diagnostics, outputDirectory),
      catch: (cause) => cause,
    }).pipe(Effect.orElseSucceed((): string | null => null));
    if (writtenDirectory === null || (!verbose && !outputDirectory)) return;

    const pathLine = highlighter.gray(`  Full diagnostics written to ${writtenDirectory}`);
    const useStderr = stream === "stderr" || (Boolean(outputDirectory) && isJsonModeActive());
    yield* useStderr
      ? Effect.sync(() => process.stderr.write(`${pathLine}\n`))
      : Console.log(pathLine);
  });
