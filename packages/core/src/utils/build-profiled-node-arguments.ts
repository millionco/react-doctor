export interface BuildProfiledNodeArgumentsInput {
  readonly argumentsList: readonly string[];
  readonly cpuProfileDirectory: string | undefined;
  readonly heapProfileDirectory: string | undefined;
}

export const buildProfiledNodeArguments = (input: BuildProfiledNodeArgumentsInput): string[] => [
  ...(input.cpuProfileDirectory
    ? ["--cpu-prof", `--cpu-prof-dir=${input.cpuProfileDirectory}`]
    : []),
  ...(input.heapProfileDirectory
    ? ["--heap-prof", `--heap-prof-dir=${input.heapProfileDirectory}`]
    : []),
  ...input.argumentsList,
];
