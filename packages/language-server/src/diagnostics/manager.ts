import type { Diagnostic as LspDiagnostic, Position } from "vscode-languageserver";
import { SILENT_LOGGER, type Logger, type ScanOutcome, type TextProvider } from "../types.js";
import { isPositionInRange } from "../text/positions.js";
import { fsPathToUri, uriToFsPath } from "../text/uri.js";
import { toLspDiagnostic } from "./mapper.js";

export interface DiagnosticsManagerOptions {
  /** Sends the authoritative diagnostic set for a URI to the client. */
  readonly publish: (uri: string, diagnostics: LspDiagnostic[]) => void;
  /** Resolves current file text (open buffer or disk) for precise ranges. */
  readonly textProvider: TextProvider;
  /**
   * Whether a file is open in the editor. Background (disk) scans —
   * including the whole-project `scanWorkspace` audit — must not overwrite
   * or clear the live diagnostics of an open buffer; those belong to
   * interactive overlay scans.
   */
  readonly isOpen?: (fsPath: string) => boolean;
  readonly logger?: Logger;
}

/**
 * Owns the published-diagnostic state. Maps scan outcomes to LSP
 * diagnostics, publishes complete per-URI replacement sets (so the
 * client never accumulates duplicates), and clears stale diagnostics
 * when a project rescan no longer reports a file. Also answers
 * position lookups for hovers and pull-diagnostic requests.
 */
export class DiagnosticsManager {
  private readonly byUri = new Map<string, LspDiagnostic[]>();
  private readonly projectUris = new Map<string, Set<string>>();
  private readonly publish: DiagnosticsManagerOptions["publish"];
  private readonly textProvider: TextProvider;
  private readonly isOpen: (fsPath: string) => boolean;
  private readonly logger: Logger;

  constructor(options: DiagnosticsManagerOptions) {
    this.publish = options.publish;
    this.textProvider = options.textProvider;
    this.isOpen = options.isOpen ?? (() => false);
    this.logger = options.logger ?? SILENT_LOGGER;
  }

  /** Applies a completed scan: maps, stores, publishes, and clears stale URIs. */
  applyOutcome(outcome: ScanOutcome): void {
    if (!outcome.ok && !outcome.skipped) {
      this.logger.warn(
        `Scan of ${outcome.request.projectDirectory} failed: ${outcome.error ?? "unknown error"}`,
      );
    }

    const project = outcome.request.projectDirectory;
    const liveUris = new Set<string>();
    // A background disk scan (workspace chunk or whole-project audit) must
    // not touch a file open in the editor — its live diagnostics come from
    // interactive overlay scans of the unsaved buffer.
    const protectOpen = outcome.request.priority === "background";
    const isProtectedPath = (fsPath: string): boolean => protectOpen && this.isOpen(fsPath);

    for (const [fsPath, coreDiagnostics] of outcome.byFile) {
      if (isProtectedPath(fsPath)) continue;
      const uri = fsPathToUri(fsPath);
      const text = this.textProvider(fsPath);
      const lspDiagnostics = coreDiagnostics.map((diagnostic) =>
        toLspDiagnostic({ diagnostic, fsPath, text }),
      );
      if (lspDiagnostics.length > 0) {
        this.byUri.set(uri, lspDiagnostics);
        liveUris.add(uri);
      } else {
        this.byUri.delete(uri);
      }
      this.publish(uri, lspDiagnostics);
    }

    // A failed, lint-degraded, partially-failed, or skipped scan didn't
    // reliably assess every requested file. Record what it found, but never
    // clear existing diagnostics — a transient/partial failure or a graceful
    // skip must not strip squiggles a later successful scan would reproduce.
    if (!outcome.ok || outcome.skipped || outcome.didLintFail || outcome.lintIncomplete) {
      const tracked = this.projectUris.get(project) ?? new Set<string>();
      for (const uri of liveUris) tracked.add(uri);
      this.projectUris.set(project, tracked);
      return;
    }

    // Files explicitly requested but absent from byFile were scanned
    // clean — clear any diagnostics previously shown for them.
    for (const fsPath of outcome.requestedPaths) {
      if (isProtectedPath(fsPath)) continue;
      if (outcome.byFile.has(fsPath)) continue;
      const uri = fsPathToUri(fsPath);
      if (this.byUri.has(uri)) this.byUri.delete(uri);
      this.publish(uri, []);
    }

    this.reconcileProjectUris(project, liveUris, outcome, protectOpen);
  }

  private reconcileProjectUris(
    project: string,
    liveUris: Set<string>,
    outcome: ScanOutcome,
    protectOpen: boolean,
  ): void {
    if (outcome.coversProject) {
      const previous = this.projectUris.get(project) ?? new Set<string>();
      const next = new Set(liveUris);
      for (const uri of previous) {
        if (liveUris.has(uri)) continue;
        // Keep an open file's diagnostics (and tracking) — a whole-project
        // disk audit must not clear what an interactive scan owns.
        if (protectOpen && this.isOpen(uriToFsPath(uri))) {
          next.add(uri);
          continue;
        }
        this.byUri.delete(uri);
        this.publish(uri, []);
      }
      this.projectUris.set(project, next);
      return;
    }

    const set = this.projectUris.get(project) ?? new Set<string>();
    for (const uri of liveUris) set.add(uri);
    for (const fsPath of outcome.requestedPaths) {
      const uri = fsPathToUri(fsPath);
      if (!liveUris.has(uri)) set.delete(uri);
    }
    this.projectUris.set(project, set);
  }

  /** Current published diagnostics for a URI (for pull-diagnostic requests). */
  get(uri: string): LspDiagnostic[] {
    return this.byUri.get(uri) ?? [];
  }

  /** Diagnostics whose range contains `position` (for hover / code actions). */
  findAt(uri: string, position: Position): LspDiagnostic[] {
    return (this.byUri.get(uri) ?? []).filter((diagnostic) =>
      isPositionInRange(diagnostic.range, position),
    );
  }

  /** Every URI that currently has published diagnostics. */
  trackedUris(): string[] {
    return [...this.byUri.keys()];
  }

  /**
   * Clears diagnostics for a project's tracked files that are no longer
   * "live" (present in `liveFsPaths`). Used after a chunked workspace scan,
   * which covers no project as a whole, to drop files that left the
   * enumeration (deleted / gitignored / renamed) and would otherwise keep
   * stale squiggles.
   */
  retainProjectFiles(project: string, liveFsPaths: Iterable<string>): void {
    const tracked = this.projectUris.get(project);
    if (!tracked) return;
    const liveUris = new Set<string>();
    for (const fsPath of liveFsPaths) liveUris.add(fsPathToUri(fsPath));
    for (const uri of [...tracked]) {
      if (liveUris.has(uri)) continue;
      this.byUri.delete(uri);
      this.publish(uri, []);
      tracked.delete(uri);
    }
  }

  /** Clears (and publishes empty for) every URI owned by a project. */
  clearProject(project: string): void {
    const uris = this.projectUris.get(project);
    if (!uris) return;
    for (const uri of uris) {
      this.byUri.delete(uri);
      this.publish(uri, []);
    }
    this.projectUris.delete(project);
  }

  /** Clears a single URI. */
  clearUri(uri: string): void {
    if (this.byUri.delete(uri)) this.publish(uri, []);
    for (const uris of this.projectUris.values()) uris.delete(uri);
  }
}
