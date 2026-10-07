export const buildOxlintTimingArguments = (argumentsList: readonly string[]): string[] => {
  const timingArguments = [...argumentsList];
  const formatFlagIndex = timingArguments.indexOf("--format");
  if (formatFlagIndex === -1 || formatFlagIndex + 1 >= timingArguments.length) {
    throw new Error("Oxlint timing arguments require a --format value");
  }
  timingArguments[formatFlagIndex + 1] = "default";
  timingArguments.push("--debug", "timings", "--quiet");
  return timingArguments;
};
