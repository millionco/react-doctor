// Estimated total command-line length of an argv (each argument plus one
// separator char), compared against `SPAWN_ARGS_MAX_LENGTH_CHARS` by both
// lint batchers so a batch never exceeds the spawn-args budget.
export const estimateArgsLength = (args: ReadonlyArray<string>): number =>
  args.reduce((total, argument) => total + argument.length + 1, 0);
