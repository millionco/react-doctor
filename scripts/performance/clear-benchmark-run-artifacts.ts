import * as fs from "node:fs";
import * as path from "node:path";
import { BENCHMARK_RUNS_DIRECTORY_NAME } from "./constants.ts";

export const clearBenchmarkRunArtifacts = (outputDirectory: string): void => {
  fs.rmSync(path.join(outputDirectory, BENCHMARK_RUNS_DIRECTORY_NAME), {
    recursive: true,
    force: true,
  });
};
