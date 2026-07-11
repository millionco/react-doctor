import * as fs from "node:fs";
import * as path from "node:path";
import {
  BENCHMARK_OUTPUT_MARKER_CONTENT,
  BENCHMARK_OUTPUT_MARKER_FILENAME,
  BENCHMARK_RUNS_DIRECTORY_NAME,
  BENCHMARK_RUNS_MARKER_CONTENT,
  BENCHMARK_RUNS_MARKER_FILENAME,
} from "./constants.ts";
import { hasValidFileMarker } from "./has-valid-file-marker.ts";

export const clearBenchmarkRunArtifacts = (outputDirectory: string): void => {
  const outputMarkerPath = path.join(outputDirectory, BENCHMARK_OUTPUT_MARKER_FILENAME);
  const hasValidOutputMarker = hasValidFileMarker(
    outputMarkerPath,
    BENCHMARK_OUTPUT_MARKER_CONTENT,
  );
  if (fs.existsSync(outputMarkerPath) && !hasValidOutputMarker) {
    throw new Error(`Invalid benchmark output marker: ${outputMarkerPath}`);
  }
  const outputArtifactPaths = ["results.json", "results.md"].map((artifactFilename) =>
    path.join(outputDirectory, artifactFilename),
  );
  if (
    !hasValidOutputMarker &&
    outputArtifactPaths.some((artifactPath) => fs.existsSync(artifactPath))
  ) {
    throw new Error(`Refusing to replace unmarked benchmark output artifacts: ${outputDirectory}`);
  }
  const runsDirectory = path.join(outputDirectory, BENCHMARK_RUNS_DIRECTORY_NAME);
  const markerPath = path.join(runsDirectory, BENCHMARK_RUNS_MARKER_FILENAME);
  if (fs.existsSync(runsDirectory)) {
    const runsDirectoryStats = fs.lstatSync(runsDirectory);
    if (!runsDirectoryStats.isDirectory() || runsDirectoryStats.isSymbolicLink()) {
      throw new Error(`Benchmark runs path must be a directory: ${runsDirectory}`);
    }
    const runsDirectoryEntries = fs.readdirSync(runsDirectory);
    if (runsDirectoryEntries.length > 0) {
      if (!hasValidFileMarker(markerPath, BENCHMARK_RUNS_MARKER_CONTENT)) {
        throw new Error(`Refusing to replace unmarked benchmark runs directory: ${runsDirectory}`);
      }
    }
  }
  fs.rmSync(runsDirectory, {
    recursive: true,
    force: true,
  });
  fs.mkdirSync(runsDirectory, { recursive: true });
  fs.writeFileSync(markerPath, BENCHMARK_RUNS_MARKER_CONTENT);
  fs.writeFileSync(outputMarkerPath, BENCHMARK_OUTPUT_MARKER_CONTENT);
  for (const artifactPath of outputArtifactPaths) {
    fs.rmSync(artifactPath, { force: true });
  }
};
