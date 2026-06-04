import * as Effect from "effect/Effect";

// Raw stdout write with no trailing newline — for in-place terminal animations
// (cursor moves, line rewrites) that `Console.log` can't express.
export const writeStdout = (text: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(text);
  });
