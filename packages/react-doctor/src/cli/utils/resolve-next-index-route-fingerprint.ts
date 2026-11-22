import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { collectCrossFileDependencyProbes } from "oxlint-plugin-react-doctor/core";
import { SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES } from "./constants.js";

const NEXT_INDEX_ROUTE = /(?:^|\/)pages\/index\.[jt]sx?$/;

// Whole-scan replay runs before the lint sidecar can check ignored files.
export const resolveNextIndexRouteFingerprint = (
  directory: string,
  analyzedPaths: ReadonlyArray<string>,
): string | null => {
  const existencePaths = new Set<string>();
  const contentPaths = new Set<string>();
  try {
    for (const filename of analyzedPaths) {
      if (!NEXT_INDEX_ROUTE.test(filename.replaceAll("\\", "/"))) continue;
      const absoluteFilePath = path.resolve(directory, filename);
      const stat = fs.statSync(absoluteFilePath);
      if (!stat.isFile() || stat.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES) return null;
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath,
        sourceText: fs.readFileSync(absoluteFilePath, "utf8"),
        ruleIds: ["rules-of-hooks"],
      });
      if (trace === null) return null;
      for (const dependency of trace.contentPaths) contentPaths.add(dependency);
      for (const dependency of trace.existencePaths) existencePaths.add(dependency);
    }
    if (existencePaths.size === 0 && contentPaths.size === 0) return "";
    const existenceAnswers = [...existencePaths].sort().map((filename) => {
      const stat = fs.statSync(filename, { throwIfNoEntry: false });
      const kind = stat?.isFile() ? "file" : stat?.isDirectory() ? "directory" : "other";
      return [filename, stat ? kind : "missing"];
    });
    const contentAnswers = [...contentPaths].sort().map((filename) => {
      const stat = fs.statSync(filename, { throwIfNoEntry: false });
      if (!stat?.isFile()) return [filename, "absent"];
      if (stat.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES) {
        throw new Error("Route dependency exceeds the cache hashing limit");
      }
      const digest = createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
      return [filename, digest];
    });
    return createHash("sha256")
      .update(JSON.stringify([existenceAnswers, contentAnswers]))
      .digest("hex");
  } catch {
    return null;
  }
};
