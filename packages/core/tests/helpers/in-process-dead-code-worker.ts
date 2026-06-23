import { analyze, defineConfig } from "../../src/deslop/index.js";

interface DeadCodeWorkerInput {
  readonly rootDirectory: string;
  readonly entryPatterns: ReadonlyArray<string>;
  readonly tsConfigPath?: string;
  readonly ignorePatterns: ReadonlyArray<string>;
}

/**
 * Runs the deslop engine in-process for core's dead-code integration tests,
 * mirroring the normalization the production child-process worker does in
 * `check-dead-code.ts`. The production path spawns a child process that
 * `import("deslop-js")`s the published facade; since `deslop-js` now builds
 * after `core` (it bundles core), tests can't rely on that artifact existing,
 * and the subprocess isolation is a production concern, not engine behavior.
 * This exercises the same `analyze`/`defineConfig` logic the facade re-exports.
 */
export const inProcessDeadCodeWorker = (
  input: DeadCodeWorkerInput,
): { result: Promise<unknown> } => ({
  result: (async () => {
    const config = defineConfig({
      rootDir: input.rootDirectory,
      ...(input.entryPatterns.length > 0 ? { entryPatterns: input.entryPatterns } : {}),
      ...(input.tsConfigPath ? { tsConfigPath: input.tsConfigPath } : {}),
      ...(input.ignorePatterns.length > 0 ? { ignorePatterns: input.ignorePatterns } : {}),
    });
    const result = await analyze(config);
    return {
      unusedFiles: result.unusedFiles.map((unusedFile) => ({ path: unusedFile.path })),
      unusedExports: result.unusedExports.map((unusedExport) => ({
        path: unusedExport.path,
        name: unusedExport.name,
        line: unusedExport.line,
        column: unusedExport.column,
        isTypeOnly: unusedExport.isTypeOnly,
      })),
      unusedDependencies: result.unusedDependencies.map((unusedDependency) => ({
        name: unusedDependency.name,
        isDevDependency: unusedDependency.isDevDependency,
      })),
      circularDependencies: result.circularDependencies.map((cycle) => ({ files: cycle.files })),
    };
  })(),
});
