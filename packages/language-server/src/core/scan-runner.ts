import path from "node:path";
import {
  computeConfigFingerprint,
  hashFileContents,
  runEditorScan,
  type Diagnostic as CoreDiagnostic,
} from "@react-doctor/core";
import {
  SILENT_LOGGER,
  type CancellationToken,
  type Logger,
  type PerformScan,
  type ScanOutcome,
  type ScanRequest,
  type TextProvider,
} from "../types.js";
import { normalizeFsPath } from "../text/uri.js";
import { toProjectRelative } from "../utils/to-project-relative.js";
import { createLintCache, type FileIdentity, type LintCache } from "./lint-cache.js";
import { materializeOverlay, type OverlaySnapshot } from "./overlay.js";

export interface ScanRunnerOptions {
  /** Node binary able to load the oxlint native binding, or `null`. */
  readonly nodeBinaryPath: string | null;
  /** Reads live file text (open buffer first, then disk) for overlays. */
  readonly readText: TextProvider;
  /**
   * Whether a file is currently open in the editor. Background disk scans
   * re-check this at scan time (not just enqueue time) so a file opened
   * mid-scan isn't overwritten by an already-queued chunk.
   */
  readonly isOpen?: (fsPath: string) => boolean;
  /** React Doctor version, part of the lint-cache config fingerprint. */
  readonly version: string;
  /** Disable the persistent lint cache (kill switch). Defaults to enabled. */
  readonly enableCache?: boolean;
  readonly logger?: Logger;
}

export interface ScanRunner {
  readonly performScan: PerformScan;
  /** Drop in-memory caches after a config change (next scan reloads fresh). */
  readonly invalidateCaches: () => void;
  /** Flush all caches to disk (on shutdown). */
  readonly dispose: () => void;
}

/**
 * Resolves a diagnostic's (possibly relative, possibly overlay-temp)
 * file path back to the canonical absolute path inside the real project.
 */
const resolveDiagnosticFsPath = (
  rawFilePath: string,
  scanDirectory: string,
  projectDirectory: string,
  overlay: OverlaySnapshot | null,
): string => {
  const normalized = rawFilePath.replace(/\\/g, "/");
  const absolute = path.isAbsolute(normalized)
    ? normalized
    : path.posix.join(scanDirectory.replace(/\\/g, "/"), normalized);

  if (overlay !== null) {
    for (const prefix of [overlay.tempDirectory, overlay.realTempDirectory]) {
      const normalizedPrefix = prefix.replace(/\\/g, "/");
      if (absolute === normalizedPrefix || absolute.startsWith(`${normalizedPrefix}/`)) {
        const rest = absolute.slice(normalizedPrefix.length);
        return normalizeFsPath(`${projectDirectory}${rest}`);
      }
    }
  }

  return normalizeFsPath(absolute);
};

const readFileIdentity = (fsPath: string): FileIdentity | null => {
  const contentHash = hashFileContents(fsPath);
  return contentHash === null ? null : { contentHash };
};

/**
 * Outcome for a per-file request served without running oxlint (every
 * file was cached, or none resolved inside the project). `byFile` holds
 * any cache hits; requested files absent from it are cleared downstream.
 */
const outcomeWithoutScan = (
  request: ScanRequest,
  byFile: Map<string, CoreDiagnostic[]>,
  requestedPaths: ReadonlyArray<string>,
): ScanOutcome => ({
  request,
  ok: true,
  skipped: false,
  byFile,
  coversProject: false,
  requestedPaths,
  project: null,
  didLintFail: false,
  lintFailureReason: null,
  lintIncomplete: false,
  error: null,
});

/**
 * Creates the scan runner used by the scheduler. Each scan runs
 * `runEditorScan` (offline, no score, no git) against either the live
 * overlay tree (unsaved buffers) or disk, groups diagnostics by canonical
 * absolute path, and reports stale-detection metadata.
 *
 * A persistent per-file lint cache (keyed by content, namespaced by a
 * config fingerprint) short-circuits unchanged files so a re-opened editor
 * or repeated workspace scan skips the oxlint subprocess for everything it
 * hasn't edited. The cache applies only to disk-based, lint-only, per-file
 * scans — overlay scans carry unsaved content, and whole-project /
 * dead-code scans aren't per-file cacheable.
 */
export const createScanRunner = (options: ScanRunnerOptions): ScanRunner => {
  const logger = options.logger ?? SILENT_LOGGER;
  const cacheEnabled = options.enableCache ?? true;
  const caches = new Map<string, LintCache>();

  const getCache = (projectDirectory: string): LintCache => {
    const existing = caches.get(projectDirectory);
    if (existing) return existing;
    const fingerprint = computeConfigFingerprint(projectDirectory, options.version);
    const cache = createLintCache({ projectDirectory, fingerprint, logger });
    caches.set(projectDirectory, cache);
    return cache;
  };

  const performScan = async (
    request: ScanRequest,
    token: CancellationToken,
  ): Promise<ScanOutcome | null> => {
    if (token.isCancelled) return null;

    const projectDirectory = normalizeFsPath(request.projectDirectory);
    const allRequested = request.files.map(normalizeFsPath);
    const isWholeProject = allRequested.length === 0;
    // Background disk chunks skip files open in the editor — re-checked here
    // (not just at enqueue time) so a file opened mid-scan keeps its live
    // overlay diagnostics instead of being clobbered by a queued chunk.
    const requestedPaths =
      request.priority === "background" && !request.useOverlay && options.isOpen
        ? allRequested.filter((fsPath) => !options.isOpen?.(fsPath))
        : allRequested;

    const cache =
      cacheEnabled && !isWholeProject && !request.useOverlay && !request.runDeadCode
        ? getCache(projectDirectory)
        : null;

    // Partition into cache hits (skip oxlint) and files that need scanning.
    // Fresh results are merged into `byFile` after the scan below.
    const byFile = new Map<string, CoreDiagnostic[]>();
    const identityByPath = new Map<string, FileIdentity>();
    let filesToScan = requestedPaths;
    if (cache) {
      const uncached: string[] = [];
      for (const fsPath of requestedPaths) {
        const identity = readFileIdentity(fsPath);
        if (identity) {
          identityByPath.set(fsPath, identity);
          const hit = cache.lookup(fsPath, identity);
          if (hit !== null) {
            if (hit.length > 0) byFile.set(fsPath, hit);
            continue;
          }
        }
        uncached.push(fsPath);
      }
      filesToScan = uncached;
    }

    // Whole batch served from cache → no subprocess needed.
    if (cache && filesToScan.length === 0) {
      return outcomeWithoutScan(request, byFile, requestedPaths);
    }

    let scanDirectory = projectDirectory;
    let includePaths: string[] | undefined;
    let overlay: OverlaySnapshot | null = null;

    try {
      if (!isWholeProject) {
        if (request.useOverlay) {
          overlay = materializeOverlay({
            projectDirectory,
            files: filesToScan,
            readText: options.readText,
          });
        }
        if (overlay !== null) {
          scanDirectory = overlay.tempDirectory;
          includePaths = overlay.relativePaths;
        } else {
          includePaths = filesToScan
            .map((filePath) => toProjectRelative(projectDirectory, filePath))
            .filter((relative): relative is string => relative !== null);
        }

        // A per-file request whose paths all resolved outside the project
        // (or whose buffers were unreadable) yields an empty include list.
        // Return null (no result): falling through, an empty `includePaths`
        // would be treated as a whole-project scan, and emitting an outcome
        // would clear those files as if they were lint-clean even though
        // nothing was scanned.
        if (includePaths.length === 0) {
          return null;
        }
      }

      const result = await runEditorScan({
        directory: scanDirectory,
        ...(includePaths !== undefined ? { includePaths } : {}),
        runDeadCode: request.runDeadCode,
        lint: true,
        ...(options.nodeBinaryPath !== null ? { nodeBinaryPath: options.nodeBinaryPath } : {}),
      });

      if (token.isCancelled) return null;

      for (const diagnostic of result.diagnostics) {
        const fsPath = resolveDiagnosticFsPath(
          diagnostic.filePath,
          scanDirectory,
          projectDirectory,
          overlay,
        );
        const existing = byFile.get(fsPath);
        if (existing) existing.push(diagnostic);
        else byFile.set(fsPath, [diagnostic]);
      }

      // Cache fresh results — but only when the scan fully succeeded (not a
      // graceful skip or a partial failure), so a file that wasn't actually
      // linted is never recorded as clean.
      if (
        cache &&
        result.ok &&
        !result.skipped &&
        !result.didLintFail &&
        result.lintPartialFailures.length === 0
      ) {
        for (const fsPath of filesToScan) {
          const identity = identityByPath.get(fsPath);
          if (!identity) continue;
          cache.store(fsPath, identity, byFile.get(fsPath) ?? []);
        }
        cache.schedulePersist();
      }

      if (result.error !== null) {
        logger.warn(`Scan error in ${projectDirectory}: ${result.error}`);
      }

      return {
        request,
        ok: result.ok,
        skipped: result.skipped,
        byFile,
        coversProject: isWholeProject,
        requestedPaths,
        project: result.project,
        didLintFail: result.didLintFail,
        lintFailureReason: result.lintFailureReason,
        lintIncomplete: result.lintPartialFailures.length > 0,
        error: result.error,
      };
    } finally {
      overlay?.cleanup();
    }
  };

  return {
    performScan,
    invalidateCaches: () => caches.clear(),
    dispose: () => {
      for (const cache of caches.values()) cache.flush();
      caches.clear();
    },
  };
};
