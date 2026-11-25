import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { readRealpathIdentity } from "@react-doctor/core";
import {
  collectCrossFileDependencyProbes,
  hasPotentialSplitGenerationReactSource,
  resetManifestCaches,
} from "oxlint-plugin-react-doctor/core";
import { SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES } from "./constants.js";
import { isRecord } from "./git-hook-shared.js";

export interface CrossFileClosureSnapshot {
  readonly contentPaths: ReadonlyArray<string>;
  readonly existencePaths: ReadonlyArray<string>;
  readonly directoryPaths: ReadonlyArray<string>;
  readonly realpathPaths: ReadonlyArray<string>;
  readonly fingerprint: string;
}
const absolutePaths = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && path.isAbsolute(entry));
export const isCrossFileClosureSnapshot = (value: unknown): value is CrossFileClosureSnapshot =>
  isRecord(value) &&
  absolutePaths(value.contentPaths) &&
  absolutePaths(value.existencePaths) &&
  absolutePaths(value.directoryPaths) &&
  absolutePaths(value.realpathPaths) &&
  typeof value.fingerprint === "string";
const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
const readSource = (filename: string): Buffer | null => {
  const stat = fs.statSync(filename, { throwIfNoEntry: false });
  if (!stat?.isFile()) return null;
  if (stat.size > SCAN_RESULT_CACHE_MAX_HASHED_FILE_SIZE_BYTES)
    throw new Error("Oversized closure source");
  return fs.readFileSync(filename);
};
const fingerprint = (snapshot: Omit<CrossFileClosureSnapshot, "fingerprint">): string | null => {
  try {
    const content = snapshot.contentPaths.map((filename) => {
      const bytes = readSource(filename);
      if (
        bytes !== null &&
        hasPotentialSplitGenerationReactSource(filename, bytes.toString("utf8"))
      )
        throw new Error("Unbounded loading ownership proof");
      return [filename, bytes === null ? "absent" : hash(bytes)];
    });
    const existence = snapshot.existencePaths.map((filename) => {
      const stat = fs.statSync(filename, { throwIfNoEntry: false });
      return [
        filename,
        !stat ? "missing" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
      ];
    });
    const directories = snapshot.directoryPaths.map((filename) => {
      const entries = fs.readdirSync(filename, { withFileTypes: true });
      const members = entries.map((entry) => [
        entry.name,
        entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      ]);
      members.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
      return [filename, hash(JSON.stringify(members))];
    });
    const realpaths = snapshot.realpathPaths.map((filename) => [
      filename,
      readRealpathIdentity(filename),
    ]);
    return hash(JSON.stringify([content, existence, directories, realpaths]));
  } catch {
    return null;
  }
};
export const isCurrentCrossFileClosureSnapshot = (snapshot: CrossFileClosureSnapshot): boolean =>
  fingerprint(snapshot) === snapshot.fingerprint;

// Collect source and consumer dependencies for package-scoped Hook analysis.
// Reuse identical rule collectors so negative resolutions remain fingerprinted.
export const createCrossFileClosureSnapshot = (
  directory: string,
  analyzedPaths: ReadonlyArray<string>,
): CrossFileClosureSnapshot | null => {
  try {
    resetManifestCaches();
    const contentPaths = new Set<string>();
    const existencePaths = new Set<string>();
    const directoryPaths = new Set<string>();
    const realpathPaths = new Set<string>();
    for (const relativePath of analyzedPaths) {
      if (!/\.[cm]?[jt]sx?$/i.test(relativePath)) continue;
      const filename = path.resolve(directory, relativePath);
      const bytes = readSource(filename);
      if (bytes === null) return null;
      const sourceText = bytes.toString("utf8");
      if (hasPotentialSplitGenerationReactSource(filename, sourceText)) return null;
      // Conservative cheap filter; source edits remain pinned by the ordinary
      // scan key. Literal import and class keywords also occur in comments.
      if (
        !sourceText.includes("class") &&
        !sourceText.includes("import") &&
        !sourceText.includes("require") &&
        !sourceText.includes("React")
      )
        continue;
      const ruleIds = ["rules-of-hooks", "no-pass-live-state-to-parent"];
      if (filename.endsWith(".tsx") && sourceText.includes("@stencil/core"))
        ruleIds.push("no-unknown-property");
      if (sourceText.includes("useEffect") || sourceText.includes("\\u"))
        ruleIds.push("exhaustive-deps");
      if (sourceText.includes("focus") || sourceText.includes("\\u"))
        ruleIds.push("no-chain-state-updates");
      if (sourceText.includes("!") && sourceText.includes("export")) {
        ruleIds.push("no-adjust-state-on-prop-change");
      }
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText,
        ruleIds,
      });
      if (trace === null) return null;
      contentPaths.add(filename);
      for (const item of trace.contentPaths) contentPaths.add(item);
      for (const item of trace.existencePaths) existencePaths.add(item);
      for (const item of trace.directoryPaths) directoryPaths.add(item);
      for (const item of trace.realpathPaths) realpathPaths.add(item);
    }
    const paths = {
      contentPaths: [...contentPaths].sort(),
      existencePaths: [...existencePaths].sort(),
      directoryPaths: [...directoryPaths].sort(),
      realpathPaths: [...realpathPaths].sort(),
    };
    const result = fingerprint(paths);
    return result === null ? null : { ...paths, fingerprint: result };
  } catch {
    return null;
  }
};
