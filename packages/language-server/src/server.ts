import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSourceFiles, messageFromUnknown, resolveNodeForOxlint } from "@react-doctor/core";
import {
  CodeActionKind,
  CodeActionTriggerKind,
  DidChangeWatchedFilesNotification,
  DocumentDiagnosticReportKind,
  FileChangeType,
  TextDocuments,
  TextDocumentSyncKind,
  createConnection,
  type CodeAction,
  type Connection,
  type DocumentDiagnosticReport,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  type ServerCapabilities,
  type TextEdit,
  type WorkDoneProgressServerReporter,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  ALL_COMMANDS,
  COMMAND_EXPLAIN,
  COMMAND_FIX_ALL,
  COMMAND_OPEN_DOCS,
  COMMAND_REPORT_FALSE_POSITIVE,
  COMMAND_RESTART,
  COMMAND_SCAN_FILE,
  COMMAND_SCAN_WORKSPACE,
  COMMAND_SUPPRESS_LINE,
  CONFIG_CHANGE_DEBOUNCE_MS,
  CONFIG_WATCH_FILENAMES,
  DIAGNOSTIC_SOURCE,
  DOCUMENT_CHANGE_DEBOUNCE_MS,
  INITIAL_WORKSPACE_SCAN_DELAY_MS,
  MAX_SCAN_CONCURRENCY,
  MIN_SCAN_CONCURRENCY,
  RESERVED_INTERACTIVE_SLOTS,
  SCANNABLE_EXTENSIONS,
  SERVER_DISPLAY_NAME,
  SERVER_VERSION,
  WORKSPACE_SCAN_CHUNK_SIZE,
} from "./constants.js";
import { DiagnosticsManager } from "./diagnostics/manager.js";
import {
  buildCodeActions,
  collectSuppressionTargets,
  SUPPRESS_ALL_CODE_ACTION_KIND,
} from "./features/code-actions.js";
import { buildHover } from "./features/hover.js";
import { buildFalsePositiveIssueUrl, type FalsePositiveReport } from "./features/issue-url.js";
import { buildSuppressAllTextEdits } from "./features/suppress.js";
import { createProjectGraph } from "./core/project-graph.js";
import { createScanRunner, type ScanRunner } from "./core/scan-runner.js";
import { createScheduler } from "./runtime/scheduler.js";
import { createScanTelemetry } from "./runtime/scan-telemetry.js";
import { chunk } from "./utils/chunk.js";
import { readDiagnosticData } from "./utils/read-diagnostic-data.js";
import { readPositiveIntEnv } from "./utils/read-positive-int-env.js";
import { rangesOverlap } from "./text/positions.js";
import { canonicalizeUri, fsPathToUri, normalizeFsPath, uriToFsPath } from "./text/uri.js";
import { NOOP_TELEMETRY } from "./types.js";
import type {
  Logger,
  ProjectGraph,
  ScanOutcome,
  ScanPriority,
  Scheduler,
  Telemetry,
  WorkspaceScanTrigger,
} from "./types.js";

const isScannablePath = (filePath: string): boolean =>
  SCANNABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));

const resolveWorkspaceRoots = (params: InitializeParams): string[] => {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    return params.workspaceFolders.map((folder) => uriToFsPath(folder.uri));
  }
  if (params.rootUri) return [uriToFsPath(params.rootUri)];
  if (params.rootPath) return [path.resolve(params.rootPath).replace(/\\/g, "/")];
  return [];
};

export interface StartLanguageServerOptions {
  /**
   * Analytics sink. Defaults to {@link NOOP_TELEMETRY}; the published CLI
   * injects a Sentry-backed implementation via the `experimental-lsp` entry.
   */
  readonly telemetry?: Telemetry;
}

/**
 * Builds and wires the React Doctor language server onto a connection.
 * Exposed separately from `startLanguageServer` so tests can drive it
 * over an in-memory transport.
 */
export const createServer = (
  connection: Connection,
  options: StartLanguageServerOptions = {},
): void => {
  const documents = new TextDocuments(TextDocument);
  const telemetry = options.telemetry ?? NOOP_TELEMETRY;
  const scanTelemetry = createScanTelemetry(telemetry);

  const logger: Logger = {
    info: (message) => connection.console.info(message),
    warn: (message) => connection.console.warn(message),
    error: (message) => connection.console.error(message),
  };

  let projectGraph: ProjectGraph | null = null;
  let workspaceRoots: string[] = [];
  let scheduler: Scheduler | null = null;
  let scanRunner: ScanRunner | null = null;
  let manager: DiagnosticsManager | null = null;
  let nodeBinaryPath: string | null = null;
  let supportsPullDiagnostics = false;
  let supportsWatchedFileRegistration = false;
  let supportsWorkDoneProgress = false;
  let supportsServerStatus = false;
  let supportsWorkspaceFolderChange = false;
  let lintWarningShown = false;
  let scanOnType = true;
  let configRescanTimer: ReturnType<typeof setTimeout> | null = null;
  let workDoneProgress: WorkDoneProgressServerReporter | null = null;
  let isBusy = false;
  let serverHealth: "ok" | "warning" = "ok";

  // Open documents indexed by canonical fs path → client URI. `documents`
  // keys by the exact URI the client sent, which can differ from
  // `fsPathToUri(fsPath)` (casing, encoding, drive-letter, symlinks), so a
  // naive lookup would miss the buffer and fall back to disk — silently
  // defeating the open-file protections. Maintained on open/close below.
  const openDocumentUriByPath = new Map<string, string>();

  const findOpenDocument = (fsPath: string): TextDocument | undefined => {
    const uri = openDocumentUriByPath.get(normalizeFsPath(fsPath));
    return uri === undefined ? undefined : documents.get(uri);
  };

  /** Live text of a file: open buffer first, then disk. */
  const readText = (fsPath: string): string | null => {
    const document = findOpenDocument(fsPath);
    if (document) return document.getText();
    try {
      return fs.readFileSync(fsPath, "utf8");
    } catch {
      return null;
    }
  };

  const isOpen = (fsPath: string): boolean => findOpenDocument(fsPath) !== undefined;

  const scheduleFileScan = (
    fsPath: string,
    priority: ScanPriority,
    useOverlay: boolean,
    reason: string,
  ): void => {
    if (!projectGraph || !scheduler || !isScannablePath(fsPath)) return;
    const projectDirectory = projectGraph.resolveOwningProject(fsPath);
    if (!projectDirectory) return;
    scheduler.enqueue({
      priority,
      projectDirectory,
      files: [fsPath],
      runDeadCode: false,
      useOverlay,
      reason,
    });
  };

  /** Absolute, normalized source files of a project (git-aware, gitignore-respecting). */
  const enumerateProjectFiles = (projectDirectory: string): string[] => {
    try {
      return listSourceFiles(projectDirectory).map((relative) =>
        normalizeFsPath(path.join(projectDirectory, relative)),
      );
    } catch {
      return [];
    }
  };

  const workspaceChunkSize = readPositiveIntEnv(
    "REACT_DOCTOR_LSP_CHUNK_SIZE",
    WORKSPACE_SCAN_CHUNK_SIZE,
  );

  /**
   * Lint the whole workspace as many small, independent chunks instead of
   * one giant non-cancellable scan: diagnostics stream in per chunk,
   * chunks run in parallel (bounded), and a config change / shutdown
   * drops the remaining chunks. Dead-code is NOT run here (it's a
   * whole-graph pass — see `scanWorkspaceFull`).
   */
  const scanWorkspaceLint = (trigger: WorkspaceScanTrigger): void => {
    if (!projectGraph || !scheduler) return;
    const activeScheduler = scheduler;
    const projectList = projectGraph.listProjects();
    let chunkCount = 0;
    const enqueueChunk = (projectDirectory: string, files: string[]): void => {
      chunkCount += 1;
      activeScheduler.enqueue({
        priority: "background",
        projectDirectory,
        files,
        runDeadCode: false,
        useOverlay: false,
        reason: "workspace lint chunk",
      });
    };
    const openPaths = documents.all().map((document) => normalizeFsPath(uriToFsPath(document.uri)));
    for (const project of projectList) {
      const enumerated = enumerateProjectFiles(project.directory);
      // A chunked scan never covers a project as a whole, so a file that
      // left the enumeration (deleted / gitignored / renamed) is in no
      // chunk and its diagnostics would linger. Reconcile against the live
      // set — enumeration plus open buffers (owned by interactive scans).
      manager?.retainProjectFiles(project.directory, [...enumerated, ...openPaths]);
      // Open files are owned by interactive (buffer-aware) scans; a disk
      // chunk would race and overwrite their unsaved-buffer diagnostics.
      const files = enumerated.filter((fsPath) => !isOpen(fsPath));
      if (files.length === 0) {
        // Nothing enumerable → one whole-project fallback scan. If every
        // file is merely open, it's already covered interactively — skip.
        if (enumerated.length === 0) enqueueChunk(project.directory, []);
        continue;
      }
      for (const batch of chunk(files, workspaceChunkSize)) enqueueChunk(project.directory, batch);
    }
    // Open a telemetry burst only when work was actually enqueued; the
    // scheduler's next idle transition closes it (see `onIdleChange`).
    if (chunkCount > 0) scanTelemetry.begin(trigger, projectList.length);
    logger.info(
      `Workspace lint scan: ${projectList.length} project(s), ${chunkCount} chunk(s) of up to ${workspaceChunkSize} files.`,
    );
  };

  /**
   * Full audit (lint + dead-code) per project, on-demand via the
   * `scanWorkspace` command. Dead-code is a whole-graph reachability
   * analysis, so it runs as a single per-project scan with progress.
   */
  const scanWorkspaceFull = (): void => {
    if (!projectGraph || !scheduler) return;
    const projectList = projectGraph.listProjects();
    for (const project of projectList) {
      scheduler.enqueue({
        priority: "background",
        projectDirectory: project.directory,
        files: [],
        runDeadCode: true,
        useOverlay: false,
        reason: "full workspace audit",
      });
    }
    if (projectList.length > 0) scanTelemetry.begin("manual", projectList.length);
  };

  const cancelAllProjectScans = (): void => {
    if (!projectGraph || !scheduler) return;
    for (const project of projectGraph.listProjects()) {
      scheduler.cancelProject(project.directory);
    }
  };

  /**
   * Full reset used by config changes and the restart command: cancel
   * in-flight scans, drop caches + project state, then re-scan from
   * scratch. Open buffers are re-scanned interactively (the workspace
   * scan skips them), so unsaved edits aren't left with stale diagnostics.
   */
  const rescanWorkspaceFromScratch = (trigger: WorkspaceScanTrigger): void => {
    cancelAllProjectScans();
    scanRunner?.invalidateCaches();
    projectGraph?.invalidate();
    projectGraph?.refresh();
    for (const document of documents.all()) {
      scheduleFileScan(uriToFsPath(document.uri), "interactive", true, trigger);
    }
    scanWorkspaceLint(trigger);
  };

  /**
   * rust-analyzer-style persistent status (`experimental/serverStatus`):
   * `quiescent: false` while scans are running, `health: "warning"` when
   * lint is degraded. Companion editor clients render this in a status
   * bar; clients that don't opt in simply never receive it.
   */
  const publishServerStatus = (): void => {
    if (!supportsServerStatus) return;
    void connection.sendNotification("experimental/serverStatus", {
      health: serverHealth,
      quiescent: !isBusy,
      ...(serverHealth === "warning"
        ? { message: "Lint is degraded — diagnostics may be incomplete." }
        : {}),
    });
  };

  /**
   * Drives the "scanning" indicator: a native LSP work-done progress
   * (spinner in capable clients) plus the `quiescent` flag in the status
   * notification. Guards the async progress-create against a busy→idle
   * flip happening mid-round-trip so a progress is never orphaned.
   */
  const setBusy = async (busy: boolean): Promise<void> => {
    if (busy === isBusy) return;
    isBusy = busy;
    publishServerStatus();
    if (!supportsWorkDoneProgress) return;
    if (busy) {
      const reporter = await connection.window.createWorkDoneProgress();
      if (!isBusy) {
        reporter.done();
        return;
      }
      workDoneProgress = reporter;
      reporter.begin(SERVER_DISPLAY_NAME, undefined, "Scanning…", false);
    } else if (workDoneProgress) {
      workDoneProgress.done();
      workDoneProgress = null;
    }
  };

  const maybeWarnLintUnavailable = (outcome: ScanOutcome): void => {
    if (!outcome.didLintFail) {
      // Lint recovered → clear degraded status so it doesn't stay stuck on
      // "warning" after a later scan succeeds.
      if (serverHealth === "warning") {
        serverHealth = "ok";
        lintWarningShown = false;
        publishServerStatus();
      }
      return;
    }
    if (serverHealth !== "warning") {
      serverHealth = "warning";
      publishServerStatus();
    }
    if (lintWarningShown) return;
    lintWarningShown = true;
    const reason = outcome.lintFailureReason ?? "oxlint could not run";
    connection.window.showWarningMessage(
      `${SERVER_DISPLAY_NAME}: lint is degraded — ${reason}. Diagnostics may be incomplete.`,
    );
  };

  const applyWorkspaceEdit = async (uri: string, edits: TextEdit[]): Promise<void> => {
    if (edits.length === 0) return;
    await connection.workspace.applyEdit({ changes: { [uri]: edits } });
  };

  const openExternal = async (target: string): Promise<void> => {
    try {
      await connection.window.showDocument({ uri: target, external: true });
    } catch {
      connection.window.showInformationMessage(target);
    }
  };

  // ── Lifecycle ────────────────────────────────────────────────────

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    workspaceRoots = resolveWorkspaceRoots(params).map(normalizeFsPath);
    projectGraph = createProjectGraph({ roots: workspaceRoots, logger });

    try {
      const resolution = resolveNodeForOxlint();
      nodeBinaryPath = resolution?.binaryPath ?? null;
    } catch {
      nodeBinaryPath = null;
    }

    manager = new DiagnosticsManager({
      publish: (uri, diagnostics) => connection.sendDiagnostics({ uri, diagnostics }),
      textProvider: readText,
      isOpen,
      logger,
    });

    // Total concurrency ≈ CPU count; with one reserved interactive slot
    // the background workspace scan uses ~cpus-1 cores (oxlint JS plugins
    // are single-threaded per process, so this scales nearly linearly).
    const concurrency = readPositiveIntEnv(
      "REACT_DOCTOR_LSP_SCAN_CONCURRENCY",
      Math.max(MIN_SCAN_CONCURRENCY, Math.min(os.cpus().length, MAX_SCAN_CONCURRENCY)),
    );
    scanRunner = createScanRunner({
      nodeBinaryPath,
      readText,
      isOpen,
      version: SERVER_VERSION,
      enableCache: !["1", "true"].includes(process.env.REACT_DOCTOR_LSP_NO_CACHE ?? ""),
      logger,
    });
    scheduler = createScheduler({
      performScan: scanRunner.performScan,
      onResult: (outcome) => {
        manager?.applyOutcome(outcome);
        maybeWarnLintUnavailable(outcome);
        // Only the background workspace audit feeds the wide event; per-file
        // interactive / save scans are excluded so it tracks the audit, not
        // keystrokes.
        if (outcome.request.priority === "background") scanTelemetry.accumulate(outcome);
      },
      onError: (error, request) =>
        logger.error(`Scan of ${request.projectDirectory} threw: ${messageFromUnknown(error)}`),
      onIdleChange: (idle) => {
        void setBusy(!idle);
        // The scheduler draining is the reliable "burst settled" signal
        // (completed + cancelled chunks alike); emit the wide event here.
        if (idle) scanTelemetry.finish();
      },
      debounceMs: DOCUMENT_CHANGE_DEBOUNCE_MS,
      concurrency,
      reservedInteractiveSlots: RESERVED_INTERACTIVE_SLOTS,
      logger,
    });

    supportsPullDiagnostics = Boolean(params.capabilities.textDocument?.diagnostic);
    supportsWatchedFileRegistration = Boolean(
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration,
    );
    supportsWorkDoneProgress = Boolean(params.capabilities.window?.workDoneProgress);
    const experimental = params.capabilities.experimental as
      | { serverStatusNotification?: boolean }
      | undefined;
    supportsServerStatus = Boolean(experimental?.serverStatusNotification);
    // `onDidChangeWorkspaceFolders` throws if the client didn't advertise
    // workspace-folder support — guard the registration on this.
    supportsWorkspaceFolderChange = Boolean(params.capabilities.workspace?.workspaceFolders);
    scanOnType = readBooleanInitOption(params.initializationOptions, "scanOnType", true);

    const capabilities: ServerCapabilities = {
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
        save: { includeText: false },
      },
      hoverProvider: true,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.Source],
      },
      executeCommandProvider: { commands: [...ALL_COMMANDS] },
      // Only advertise workspace-folders support when the client supports
      // it — otherwise vscode-languageserver auto-registers folder-change
      // notifications on `initialized` and throws, aborting the initial
      // workspace scan. (We read folders from the initialize params, so
      // this capability is only needed for live multi-root updates.)
      ...(supportsWorkspaceFolderChange
        ? {
            workspace: {
              workspaceFolders: { supported: true, changeNotifications: true },
            },
          }
        : {}),
      ...(supportsPullDiagnostics
        ? {
            diagnosticProvider: {
              identifier: DIAGNOSTIC_SOURCE,
              interFileDependencies: true,
              workspaceDiagnostics: false,
            },
          }
        : {}),
    };

    return { capabilities, serverInfo: { name: SERVER_DISPLAY_NAME, version: SERVER_VERSION } };
  });

  connection.onInitialized(() => {
    if (supportsWatchedFileRegistration) {
      void connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [
          { globPattern: `**/{${CONFIG_WATCH_FILENAMES.join(",")}}` },
          {
            globPattern: `**/*.{${SCANNABLE_EXTENSIONS.map((extension) => extension.slice(1)).join(",")}}`,
          },
        ],
      });
    }

    if (nodeBinaryPath === null) {
      logger.warn(
        `${SERVER_DISPLAY_NAME}: no Node binary compatible with the oxlint native binding was found; lint will be skipped until you switch to a supported Node version.`,
      );
    }

    if (supportsWorkspaceFolderChange) {
      connection.workspace.onDidChangeWorkspaceFolders((event) => {
        const removedRoots = event.removed.map((folder) =>
          normalizeFsPath(uriToFsPath(folder.uri)),
        );
        const addedRoots = event.added.map((folder) => normalizeFsPath(uriToFsPath(folder.uri)));
        // Clear diagnostics owned by folders leaving the workspace before
        // rebuilding the graph (afterwards their projects are gone).
        const isUnderRemovedRoot = (directory: string): boolean =>
          removedRoots.some((root) => directory === root || directory.startsWith(`${root}/`));
        for (const project of projectGraph?.listProjects() ?? []) {
          if (isUnderRemovedRoot(project.directory)) {
            scheduler?.cancelProject(project.directory);
            manager?.clearProject(project.directory);
          }
        }
        // Drop core + lint caches (same as config-change / restart) so
        // discovery, config, ignore, and package metadata don't go stale
        // across folder updates.
        scanRunner?.invalidateCaches();
        projectGraph?.invalidate();
        // Discovery froze its roots at `initialize`, so rebuild the graph
        // against the updated set instead of just refreshing within it.
        workspaceRoots = [
          ...workspaceRoots.filter((root) => !removedRoots.includes(root)),
          ...addedRoots,
        ];
        projectGraph = createProjectGraph({ roots: workspaceRoots, logger });
        // Re-scan open buffers interactively (the workspace scan skips open
        // files), so documents already open in a newly-added folder get
        // diagnostics without waiting for an edit.
        for (const document of documents.all()) {
          scheduleFileScan(
            uriToFsPath(document.uri),
            "interactive",
            true,
            "workspace folders changed",
          );
        }
        scanWorkspaceLint("workspace-folders-change");
      });
    }

    telemetry.recordSessionStart({
      serverVersion: SERVER_VERSION,
      nodeMajor: nodeMajorVersion(),
      projectCount: projectGraph?.listProjects().length ?? 0,
      workspaceFolderCount: workspaceRoots.length,
      scanOnType,
      lintAvailable: nodeBinaryPath !== null,
    });

    publishServerStatus();
    setTimeout(() => scanWorkspaceLint("initial"), INITIAL_WORKSPACE_SCAN_DELAY_MS);
  });

  // ── Document sync ────────────────────────────────────────────────

  documents.onDidOpen((event) => {
    openDocumentUriByPath.set(normalizeFsPath(uriToFsPath(event.document.uri)), event.document.uri);
    scheduleFileScan(uriToFsPath(event.document.uri), "interactive", true, "open");
  });

  documents.onDidClose((event) => {
    const fsPath = uriToFsPath(event.document.uri);
    openDocumentUriByPath.delete(normalizeFsPath(fsPath));
    // Overlay scans may have published buffer-based diagnostics; once the
    // (possibly unsaved) buffer is gone, re-scan from disk so diagnostics
    // reflect the on-disk file. It's no longer open, so this reads disk.
    scheduleFileScan(fsPath, "background", false, "close");
  });

  documents.onDidChangeContent((event) => {
    // `onDidOpen` already covers the first scan; skip per-keystroke
    // overlay scans when the client opted out via `scanOnType: false`.
    if (!scanOnType) return;
    scheduleFileScan(uriToFsPath(event.document.uri), "interactive", true, "change");
  });

  documents.onDidSave((event) => {
    // Save re-lints only the saved file from disk. A whole-project
    // re-lint on every save would be pathological on large repos
    // (~100s on an 8k-file repo); dead-code refresh is on-demand via the
    // `scanWorkspace` command.
    scheduleFileScan(uriToFsPath(event.document.uri), "save", false, "save");
  });

  // ── Watched files ────────────────────────────────────────────────

  connection.onDidChangeWatchedFiles((params) => {
    let configChanged = false;
    const filesToRescan: string[] = [];

    for (const change of params.changes) {
      const fsPath = uriToFsPath(change.uri);
      const baseName = path.basename(fsPath);
      if (CONFIG_WATCH_FILENAMES.some((watched) => watched === baseName)) {
        configChanged = true;
        continue;
      }
      if (change.type === FileChangeType.Deleted) {
        manager?.clearUri(fsPathToUri(fsPath));
        continue;
      }
      if (isScannablePath(fsPath) && !isOpen(fsPath)) filesToRescan.push(fsPath);
    }

    for (const fsPath of filesToRescan) scheduleFileScan(fsPath, "background", false, "watched");

    if (configChanged) {
      if (configRescanTimer) clearTimeout(configRescanTimer);
      configRescanTimer = setTimeout(() => {
        configRescanTimer = null;
        // Config changed → in-flight scans + cached results are stale; the
        // cache reloads under a fresh fingerprint on the next scan.
        rescanWorkspaceFromScratch("config-change");
      }, CONFIG_CHANGE_DEBOUNCE_MS);
      if (typeof configRescanTimer.unref === "function") configRescanTimer.unref();
    }
  });

  // ── Hover ────────────────────────────────────────────────────────

  connection.onHover((params): Hover | null => {
    if (!manager) return null;
    const uri = canonicalizeUri(params.textDocument.uri);
    return buildHover(manager.findAt(uri, params.position));
  });

  // ── Code actions ─────────────────────────────────────────────────

  connection.onCodeAction((params): CodeAction[] => {
    if (!manager || !projectGraph) return [];
    const uri = canonicalizeUri(params.textDocument.uri);
    const fsPath = uriToFsPath(params.textDocument.uri);
    const fileDiagnostics = manager.get(uri);
    const rangeDiagnostics = fileDiagnostics.filter((diagnostic) =>
      rangesOverlap(diagnostic.range, params.range),
    );
    const project = projectGraph.resolveOwningProject(fsPath);
    const relativeFilePath = project
      ? path.relative(project, fsPath).replace(/\\/g, "/")
      : path.basename(fsPath);

    const actions = buildCodeActions({
      uri,
      fsPath,
      documentText: readText(fsPath),
      relativeFilePath,
      rangeDiagnostics,
      fileDiagnostics,
    });

    // Guard the destructive file-level "suppress all" source action. Editors
    // running code actions on save send `triggerKind: Automatic` with
    // `only: ["source"]`, which prefix-matches `source.suppressAll.reactDoctor`
    // below and would mass-insert disable comments on every save. Offer it only
    // on an explicit (Invoked) request — e.g. the Source Action menu — unless
    // the client deliberately opted in to the exact kind.
    const only = params.context.only;
    const isAutomaticTrigger = params.context.triggerKind === CodeActionTriggerKind.Automatic;
    const optedIntoSuppressAll = (only ?? []).includes(SUPPRESS_ALL_CODE_ACTION_KIND);
    const offeredActions =
      isAutomaticTrigger && !optedIntoSuppressAll
        ? actions.filter((action) => action.kind !== SUPPRESS_ALL_CODE_ACTION_KIND)
        : actions;

    // Honor `context.only`: a lightbulb request asks for `quickfix`, the
    // Source Action menu / on-save asks for `source*`. Returning the
    // wrong kinds clutters menus and risks on-save side effects.
    if (!only || only.length === 0) return offeredActions;
    return offeredActions.filter(
      (action) =>
        action.kind !== undefined &&
        only.some((kind) => action.kind === kind || action.kind?.startsWith(`${kind}.`)),
    );
  });

  // ── Pull diagnostics ─────────────────────────────────────────────

  connection.languages.diagnostics.on((params): DocumentDiagnosticReport => {
    const uri = canonicalizeUri(params.textDocument.uri);
    return {
      kind: DocumentDiagnosticReportKind.Full,
      items: manager ? manager.get(uri) : [],
    };
  });

  // ── Commands ─────────────────────────────────────────────────────

  connection.onExecuteCommand(async (params) => {
    const [firstArgument] = params.arguments ?? [];
    switch (params.command) {
      case COMMAND_SCAN_WORKSPACE: {
        // Manual re-audit: drop in-flight scans, cached per-file lint
        // results, and project metadata so the audit runs fresh against
        // current config / ignore / package data rather than reusing stale
        // cache entries on the old fingerprint.
        cancelAllProjectScans();
        scanRunner?.invalidateCaches();
        projectGraph?.invalidate();
        projectGraph?.refresh();
        scanWorkspaceFull();
        // The audit runs at background priority and so skips open buffers;
        // re-scan them interactively so an open tab isn't left stale (the
        // cancel above also dropped any pending open-buffer scans).
        for (const document of documents.all()) {
          scheduleFileScan(uriToFsPath(document.uri), "interactive", true, "scan workspace");
        }
        return;
      }
      case COMMAND_SCAN_FILE: {
        const uri = typeof firstArgument === "string" ? firstArgument : extractUri(firstArgument);
        if (uri) scheduleFileScan(uriToFsPath(uri), "interactive", true, "command");
        return;
      }
      case COMMAND_FIX_ALL: {
        const uri = typeof firstArgument === "string" ? firstArgument : extractUri(firstArgument);
        if (uri) await suppressAllInFile(canonicalizeUri(uri), uriToFsPath(uri));
        return;
      }
      case COMMAND_SUPPRESS_LINE: {
        await suppressSingle(firstArgument);
        return;
      }
      case COMMAND_EXPLAIN: {
        explain(firstArgument);
        return;
      }
      case COMMAND_OPEN_DOCS: {
        if (typeof firstArgument === "string") await openExternal(firstArgument);
        return;
      }
      case COMMAND_REPORT_FALSE_POSITIVE: {
        const report = asFalsePositiveReport(firstArgument);
        if (report) await openExternal(buildFalsePositiveIssueUrl(report));
        return;
      }
      case COMMAND_RESTART: {
        lintWarningShown = false;
        rescanWorkspaceFromScratch("restart");
        connection.window.showInformationMessage(`${SERVER_DISPLAY_NAME}: re-scanning workspace.`);
        return;
      }
      default:
        return;
    }
  });

  const findByIdentity = (uri: string, identity: string) =>
    manager?.get(uri).find((diagnostic) => readDiagnosticData(diagnostic)?.identity === identity) ??
    null;

  const suppressSingle = async (argument: unknown): Promise<void> => {
    const uri = extractUri(argument);
    const identity = extractString(argument, "identity");
    if (!uri || !identity) return;
    const canonical = canonicalizeUri(uri);
    const diagnostic = findByIdentity(canonical, identity);
    const data = diagnostic ? readDiagnosticData(diagnostic) : null;
    if (!data) return;
    const edits = buildSuppressAllTextEdits({
      documentText: readText(uriToFsPath(uri)),
      fsPath: uriToFsPath(uri),
      targets: [{ line: data.line, ruleId: data.ruleId }],
    });
    await applyWorkspaceEdit(canonical, edits);
  };

  const suppressAllInFile = async (uri: string, fsPath: string): Promise<void> => {
    if (!manager) return;
    const edits = buildSuppressAllTextEdits({
      documentText: readText(fsPath),
      fsPath,
      targets: collectSuppressionTargets(manager.get(uri)),
    });
    await applyWorkspaceEdit(uri, edits);
  };

  const explain = (argument: unknown): void => {
    const uri = extractUri(argument);
    const identity = extractString(argument, "identity");
    if (!uri || !identity) return;
    const diagnostic = findByIdentity(canonicalizeUri(uri), identity);
    const data = diagnostic ? readDiagnosticData(diagnostic) : null;
    if (!data || !diagnostic) return;
    const recommendation = data.help ? `\n\n${data.help}` : "";
    connection.window.showInformationMessage(
      `${data.ruleId} (${data.category}): ${diagnostic.message}${recommendation}`,
    );
  };

  // Tear down cleanly: stop the debounced config-rescan and any in-flight /
  // queued scans first, then flush the lint cache to disk so the next
  // session reuses it (the debounced write may not have fired). Stopping
  // work before the flush prevents a config change moments before shutdown
  // from enqueuing a rescan or re-dirtying the cache after teardown begins.
  connection.onShutdown(() => {
    if (configRescanTimer) clearTimeout(configRescanTimer);
    scheduler?.dispose();
    scanRunner?.dispose();
    // Best-effort: get queued analytics off the machine before the editor
    // tears the process down. Swallow failures — telemetry never blocks exit.
    void telemetry.flush?.().catch(() => {});
  });

  documents.listen(connection);
  connection.listen();
};

// ── Argument coercion helpers ──────────────────────────────────────

const extractUri = (argument: unknown): string | null => extractString(argument, "uri");

const extractString = (argument: unknown, key: string): string | null => {
  if (argument === null || typeof argument !== "object") return null;
  const value = (argument as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

const asFalsePositiveReport = (argument: unknown): FalsePositiveReport | null => {
  if (argument === null || typeof argument !== "object") return null;
  const record = argument as Record<string, unknown>;
  const ruleId = record.ruleId;
  if (typeof ruleId !== "string") return null;
  return {
    ruleId,
    severity: typeof record.severity === "string" ? record.severity : "warning",
    category: typeof record.category === "string" ? record.category : "",
    message: typeof record.message === "string" ? record.message : "",
    relativeFilePath: typeof record.relativeFilePath === "string" ? record.relativeFilePath : "",
    line: typeof record.line === "number" ? record.line : 1,
  };
};

const readBooleanInitOption = (options: unknown, key: string, fallback: boolean): boolean => {
  if (options === null || typeof options !== "object") return fallback;
  const value = (options as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : fallback;
};

const nodeMajorVersion = (): number =>
  Number.parseInt(process.versions.node.split(".", 1)[0] ?? "", 10) || 0;

/**
 * stdout is the LSP message channel — any stray write corrupts the
 * protocol stream and silently breaks the client. Route accidental
 * `console.log` / `info` / `debug` (from this server or any transitive
 * dependency) to stderr; structured logs still go through the LSP
 * `window/logMessage` channel via `connection.console`.
 */
const protectStdoutChannel = (): void => {
  const toStderr = (...args: unknown[]): void => {
    process.stderr.write(`${args.map((arg) => String(arg)).join(" ")}\n`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
};

/** Keep the daemon alive through stray errors — log instead of crashing the editor session. */
const installProcessGuards = (connection: Connection): void => {
  const describe = (value: unknown): string =>
    value instanceof Error ? (value.stack ?? value.message) : String(value);
  process.on("uncaughtException", (error) => {
    connection.console.error(`Uncaught exception: ${describe(error)}`);
  });
  process.on("unhandledRejection", (reason) => {
    connection.console.error(`Unhandled rejection: ${describe(reason)}`);
  });
};

/** Entry point: starts the server over stdio. */
export const startLanguageServer = (options: StartLanguageServerOptions = {}): void => {
  protectStdoutChannel();
  const connection = createConnection(process.stdin, process.stdout);
  installProcessGuards(connection);
  createServer(connection, options);
};
