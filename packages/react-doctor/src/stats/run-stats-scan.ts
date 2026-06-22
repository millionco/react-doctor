import * as path from "node:path";
import { mapWithConcurrency, runEditorScan, type Diagnostic } from "@react-doctor/core";
import { STATS_SCAN_CONCURRENCY } from "./constants.js";
import { isReactSourceFile } from "./is-react-source.js";
import { materializeReconstructedTree } from "./materialize-reconstructed-tree.js";
import { reconstructSession } from "./reconstruct-files.js";
import type { AgentSession, ReconstructedFile, SessionScanResult } from "./types.js";

const toPosix = (filePath: string): string => filePath.split(path.sep).join("/");

/** Longest shared directory of a set of absolute paths, or `null`. */
const commonAncestorDirectory = (absolutePaths: ReadonlyArray<string>): string | null => {
  if (absolutePaths.length === 0) return null;
  const splitPaths = absolutePaths.map((absolutePath) =>
    path.dirname(absolutePath).split(path.sep),
  );
  let shared = splitPaths[0];
  for (const segments of splitPaths.slice(1)) {
    let index = 0;
    while (index < shared.length && index < segments.length && shared[index] === segments[index]) {
      index += 1;
    }
    shared = shared.slice(0, index);
  }
  const joined = shared.join(path.sep);
  return joined.length > 0 ? joined : null;
};

/**
 * Map a diagnostic's path (relative to the temp dir, or absolute under it) back
 * to the real absolute path it was reconstructed from.
 */
const remapDiagnosticPath = (
  filePath: string,
  tempDirectory: string,
  realTempDirectory: string,
  scanRoot: string,
): string => {
  const normalized = toPosix(filePath);
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : `${toPosix(tempDirectory)}/${normalized}`;
  for (const prefix of [tempDirectory, realTempDirectory]) {
    const prefixPosix = toPosix(prefix);
    if (absolute === prefixPosix || absolute.startsWith(`${prefixPosix}/`)) {
      return path.normalize(`${scanRoot}${absolute.slice(prefixPosix.length)}`);
    }
  }
  return path.normalize(absolute);
};

/**
 * Resolve the directory the session's reconstructed files should be linted
 * under. Repo-scoped runs pin it to the repo root; global runs fall back to the
 * session cwd, then the common ancestor of the edited files.
 */
const resolveScanRoot = (
  session: AgentSession,
  fileAbsolutePaths: ReadonlyArray<string>,
  repoRoot: string | null,
): string | null => {
  if (repoRoot) return repoRoot;
  if (session.cwd) return session.cwd;
  return commonAncestorDirectory(fileAbsolutePaths);
};

const scanSession = async (
  session: AgentSession,
  repoRoot: string | null,
): Promise<SessionScanResult> => {
  const reconstruction = reconstructSession(session);
  const empty: SessionScanResult = {
    session,
    diagnostics: [],
    filesScanned: 0,
    reconstructedFiles: reconstruction.files.length,
    unreconstructable: reconstruction.unreconstructable.length,
  };
  // React Doctor only scores React code; ranking a model on the plain
  // backend/util/config files it also wrote would dilute its diagnostics-per-
  // file and skew the leaderboard toward whoever wrote the most non-React code.
  const reactFiles = reconstruction.files.filter((file) =>
    isReactSourceFile(file.absolutePath, file.content),
  );
  if (reactFiles.length === 0) return empty;

  const scanRoot = resolveScanRoot(
    session,
    reactFiles.map((file) => file.absolutePath),
    repoRoot,
  );
  if (!scanRoot) return empty;

  const files: ReconstructedFile[] = [];
  for (const file of reactFiles) {
    const relative = toPosix(path.relative(scanRoot, file.absolutePath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    files.push({ ...file, relativePath: relative });
  }
  if (files.length === 0) return empty;

  const tree = materializeReconstructedTree(scanRoot, files);
  try {
    const result = await runEditorScan({
      directory: tree.tempDirectory,
      includePaths: tree.relativePaths,
      lint: true,
      runDeadCode: false,
      // The node running the CLI can load oxlint's native binding.
      nodeBinaryPath: process.execPath,
    });
    const diagnostics: Diagnostic[] = result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      filePath: remapDiagnosticPath(
        diagnostic.filePath,
        tree.tempDirectory,
        tree.realTempDirectory,
        scanRoot,
      ),
    }));
    return {
      session,
      diagnostics,
      filesScanned: tree.relativePaths.length,
      reconstructedFiles: reconstruction.files.length,
      unreconstructable: reconstruction.unreconstructable.length,
    };
  } finally {
    tree.cleanup();
  }
};

export interface RunStatsScanOptions {
  /** Reports `(completedCount, totalCount)` as each session finishes. */
  readonly onProgress?: (completedCount: number, totalCount: number) => void;
}

/**
 * Reconstruct and lint every session with bounded concurrency. `repoRoot` pins
 * the scan root for repo-scoped runs; pass `null` for global runs (per-session
 * root inferred from cwd / edited files). Each session that yields content
 * spawns one oxlint subprocess, so progress is reported per session.
 */
export const runStatsScan = (
  sessions: ReadonlyArray<AgentSession>,
  repoRoot: string | null,
  options: RunStatsScanOptions = {},
): Promise<SessionScanResult[]> => {
  let completedCount = 0;
  return mapWithConcurrency(sessions, STATS_SCAN_CONCURRENCY, async (session) => {
    const result = await scanSession(session, repoRoot);
    completedCount += 1;
    options.onProgress?.(completedCount, sessions.length);
    return result;
  });
};
