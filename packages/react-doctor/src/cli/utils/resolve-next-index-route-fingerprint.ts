import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectNextIndexPageDependencyProbes,
  resetManifestCaches,
} from "oxlint-plugin-react-doctor/core";
import { SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES } from "./constants.js";
import { isRecord } from "./git-hook-shared.js";

interface NextIndexRouteProbePaths {
  readonly existencePaths: ReadonlyArray<string>;
  readonly contentPaths: ReadonlyArray<string>;
}

export interface NextIndexRouteSnapshot extends NextIndexRouteProbePaths {
  readonly fingerprint: string;
}

const areProbePaths = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && path.isAbsolute(entry));

export const isNextIndexRouteSnapshot = (value: unknown): value is NextIndexRouteSnapshot =>
  isRecord(value) &&
  areProbePaths(value.existencePaths) &&
  areProbePaths(value.contentPaths) &&
  typeof value.fingerprint === "string";

const readProbeFile = (absolutePath: string): Buffer | null => {
  const stat = fs.statSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) return null;
  if (stat.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES) {
    throw new Error("Route dependency exceeds the cache hashing limit");
  }
  return fs.readFileSync(absolutePath);
};

const resolveFingerprint = ({
  existencePaths,
  contentPaths,
}: NextIndexRouteProbePaths): string | null => {
  try {
    const existenceAnswers = existencePaths.map((filename) => {
      const stat = fs.statSync(filename, { throwIfNoEntry: false });
      const kind = stat?.isFile() ? "file" : stat?.isDirectory() ? "directory" : "other";
      return [filename, stat ? kind : "missing"];
    });
    const contentAnswers = contentPaths.map((filename) => {
      const bytes = readProbeFile(filename);
      return [
        filename,
        bytes === null ? "absent" : createHash("sha256").update(bytes).digest("hex"),
      ];
    });
    return createHash("sha256")
      .update(JSON.stringify([existenceAnswers, contentAnswers]))
      .digest("hex");
  } catch {
    return null;
  }
};

// Whole-scan replay runs before the sidecar can check the captured dependencies.
export const isCurrentNextIndexRouteSnapshot = (snapshot: NextIndexRouteSnapshot): boolean =>
  resolveFingerprint(snapshot) === snapshot.fingerprint;

export const createNextIndexRouteSnapshot = (
  directory: string,
  analyzedPaths: ReadonlyArray<string>,
  explicitPaths: ReadonlyArray<string>,
): NextIndexRouteSnapshot | null => {
  try {
    resetManifestCaches();
    const trace = collectNextIndexPageDependencyProbes(
      analyzedPaths.map((filename) => path.resolve(directory, filename)),
      (filename) => readProbeFile(filename)?.toString("utf8") ?? null,
    );
    if (trace === null) return null;
    for (const filename of explicitPaths) trace.contentPaths.add(path.resolve(directory, filename));
    const probes = {
      existencePaths: [...trace.existencePaths].sort(),
      contentPaths: [...trace.contentPaths].sort(),
    };
    const fingerprint = resolveFingerprint(probes);
    return fingerprint === null ? null : { ...probes, fingerprint };
  } catch {
    return null;
  }
};
