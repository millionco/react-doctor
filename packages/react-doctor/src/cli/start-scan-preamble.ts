import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildGitSourceListingRequest,
  buildOxlintChildEnv,
  buildOxlintWorkerSpawnSpec,
  prefetchGitCommand,
  prespawnOxlintWorkers,
  resolveConfiguredScanConcurrency,
  resolveOxlintWorkerRuntime,
  resolveReactDoctorCacheDir,
  warmReactCompilerDetection,
} from "@react-doctor/core/scan-preamble";
import {
  RUN_GIT_MAX_BUFFER_BYTES,
  SCAN_RESULT_CACHE_FILENAME,
  SCAN_RESULT_CACHE_GIT_ARGUMENTS,
} from "./utils/constants.js";
import { isCacheGloballyDisabled } from "./utils/is-cache-globally-disabled.js";
import { resolvePrefetchScanDirectory } from "./utils/resolve-prefetch-scan-directory.js";

// Evaluated before the rest of the CLI bundle (it is the first import of the
// entry) so the work a plain scan is certain to need starts while the bundle
// is still loading: git lists the project and resolves the cache identity,
// and, when no whole-repo cache can replay, a worker thread begins the
// React Compiler config detection (the one discovery step that needs the
// TypeScript compiler) and the oxlint worker processes start booting so
// they are ready by the time the first lint batch is planned.
const prespawnOxlintWorkersForScan = (): void => {
  if (process.argv.includes("--no-lint")) return;
  const workerRuntime = resolveOxlintWorkerRuntime();
  if (workerRuntime === null) return;
  const workerCount = resolveConfiguredScanConcurrency();
  prespawnOxlintWorkers(
    buildOxlintWorkerSpawnSpec({
      nodeBinaryPath: process.execPath,
      maxWorkers: workerCount,
      workerScriptPath: workerRuntime.workerScriptPath,
      oxlintPackageDirectory: workerRuntime.oxlintPackageDirectory,
      pluginPath: workerRuntime.pluginPath,
      environment: buildOxlintChildEnv(process.env),
    }),
    workerCount,
  );
};

const prefetchDirectory = resolvePrefetchScanDirectory(process.argv.slice(2), process.cwd());
if (prefetchDirectory !== null) {
  prefetchGitCommand(buildGitSourceListingRequest(prefetchDirectory));
  const isCacheDisabled = isCacheGloballyDisabled() || process.argv.includes("--no-cache");
  if (!isCacheDisabled) {
    for (const args of SCAN_RESULT_CACHE_GIT_ARGUMENTS) {
      prefetchGitCommand({
        directory: prefetchDirectory,
        args,
        maxBufferBytes: RUN_GIT_MAX_BUFFER_BYTES,
      });
    }
  }
  const canReplayScanResult =
    !isCacheDisabled &&
    fs.existsSync(
      path.join(resolveReactDoctorCacheDir(prefetchDirectory), SCAN_RESULT_CACHE_FILENAME),
    );
  if (!canReplayScanResult) {
    warmReactCompilerDetection(prefetchDirectory);
    prespawnOxlintWorkersForScan();
  }
}
