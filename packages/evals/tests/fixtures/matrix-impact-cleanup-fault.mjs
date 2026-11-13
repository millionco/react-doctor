import fs from "node:fs";
import { basename } from "node:path";

const [targetUrl, scenarioJson] = process.argv.slice(2);
const { exhaustRetries, expiredDeadline } = JSON.parse(scenarioJson);
const originalRemoveDirectory = fs.rmdir;
const busyError = Object.assign(new Error("injected busy cleanup directory"), { code: "EBUSY" });
let injectedBusyFailures = 0;
let expectedBusyFailures;
let cleanupDirectory;

fs.rmdir = (directoryPath, callback) => {
  const directory = String(directoryPath);
  if (basename(directory).startsWith("react-doctor-matrix-impact-")) {
    cleanupDirectory ??= directory;
    if (injectedBusyFailures < expectedBusyFailures) {
      injectedBusyFailures += 1;
      queueMicrotask(() => callback(busyError));
      return;
    }
  }
  originalRemoveDirectory(directoryPath, callback);
};

const { tsImport } = await import("tsx/esm/api");
const { verifyMatrixImpactManifests } = await tsImport(targetUrl, import.meta.url);
const { MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS, TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES } =
  await tsImport(new URL("../../src/constants.ts", import.meta.url).href, import.meta.url);
expectedBusyFailures = exhaustRetries ? TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES + 1 : 1;
let error = null;
let directoryRemainedAfterVerification;
try {
  const deadlineMilliseconds = expiredDeadline
    ? globalThis.performance.now()
    : globalThis.performance.now() + MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS;
  await verifyMatrixImpactManifests([], deadlineMilliseconds);
} catch (caughtError) {
  error = {
    name: caughtError.name,
    code: caughtError.code,
    sameBusyError: caughtError === busyError,
  };
} finally {
  fs.rmdir = originalRemoveDirectory;
  directoryRemainedAfterVerification = Boolean(cleanupDirectory && fs.existsSync(cleanupDirectory));
  if (cleanupDirectory) {
    fs.rmSync(cleanupDirectory, {
      recursive: true,
      force: true,
      maxRetries: TEMPORARY_DIRECTORY_REMOVE_MAX_RETRIES,
    });
  }
}
process.stdout.write(
  JSON.stringify({
    injectedBusyFailures,
    cleanupDirectoryObserved: Boolean(cleanupDirectory),
    directoryRemainedAfterVerification,
    error,
  }) + "\n",
);
