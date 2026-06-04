import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import { DiagnosticsManager } from "../../src/diagnostics/manager.js";
import { fsPathToUri as toUri } from "../../src/text/uri.js";
import type { ScanOutcome, ScanRequest } from "../../src/types.js";

const FS_PATH = "/proj/src/App.tsx";

const request: ScanRequest = {
  id: 1,
  priority: "save",
  projectDirectory: "/proj",
  files: [FS_PATH],
  runDeadCode: false,
  useOverlay: false,
  reason: "test",
};

const diagnostic = (): CoreDiagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-key",
  severity: "warning",
  message: "msg",
  help: "help",
  line: 1,
  column: 1,
  category: "Correctness",
});

const outcome = (overrides: Partial<ScanOutcome>): ScanOutcome => ({
  request,
  ok: true,
  skipped: false,
  byFile: new Map(),
  coversProject: false,
  requestedPaths: [FS_PATH],
  project: null,
  didLintFail: false,
  lintFailureReason: null,
  error: null,
  ...overrides,
});

const createManager = () => {
  const cleared: string[] = [];
  const manager = new DiagnosticsManager({
    publish: (uri, diagnostics) => {
      if (diagnostics.length === 0) cleared.push(uri);
    },
    textProvider: () => "const App = () => null\n",
  });
  return { manager, cleared };
};

describe("DiagnosticsManager.applyOutcome", () => {
  it("clears a previously-flagged file when a successful scan finds it clean", () => {
    const { manager } = createManager();
    manager.applyOutcome(outcome({ byFile: new Map([[FS_PATH, [diagnostic()]]]) }));
    const [uri] = manager.trackedUris();
    expect(manager.get(uri).length).toBe(1);

    // Clean successful scan → diagnostics cleared.
    manager.applyOutcome(outcome({ byFile: new Map() }));
    expect(manager.get(uri).length).toBe(0);
  });

  it("preserves diagnostics when the scan failed (does not strip on transient errors)", () => {
    const { manager, cleared } = createManager();
    manager.applyOutcome(outcome({ byFile: new Map([[FS_PATH, [diagnostic()]]]) }));
    const [uri] = manager.trackedUris();
    cleared.length = 0;

    manager.applyOutcome(outcome({ ok: false, error: "oxlint crashed" }));
    expect(manager.get(uri).length).toBe(1);
    expect(cleared).not.toContain(uri);
  });

  it("preserves diagnostics when lint degraded (didLintFail)", () => {
    const { manager, cleared } = createManager();
    manager.applyOutcome(outcome({ byFile: new Map([[FS_PATH, [diagnostic()]]]) }));
    const [uri] = manager.trackedUris();
    cleared.length = 0;

    manager.applyOutcome(outcome({ didLintFail: true, lintFailureReason: "partial" }));
    expect(manager.get(uri).length).toBe(1);
    expect(cleared).not.toContain(uri);
  });

  it("preserves diagnostics on a partial lint failure (lintIncomplete)", () => {
    const { manager, cleared } = createManager();
    manager.applyOutcome(outcome({ byFile: new Map([[FS_PATH, [diagnostic()]]]) }));
    const [uri] = manager.trackedUris();
    cleared.length = 0;

    // ok + !didLintFail but some files failed within the batch.
    manager.applyOutcome(outcome({ lintIncomplete: true }));
    expect(manager.get(uri).length).toBe(1);
    expect(cleared).not.toContain(uri);
  });

  it("preserves diagnostics on a graceful skip (not an analyzable project)", () => {
    const { manager, cleared } = createManager();
    manager.applyOutcome(outcome({ byFile: new Map([[FS_PATH, [diagnostic()]]]) }));
    const [uri] = manager.trackedUris();
    cleared.length = 0;

    manager.applyOutcome(outcome({ skipped: true }));
    expect(manager.get(uri).length).toBe(1);
    expect(cleared).not.toContain(uri);
  });
});

describe("DiagnosticsManager open-buffer protection", () => {
  it("a background disk scan does not overwrite an open file's diagnostics", () => {
    const openUri = toUri(FS_PATH);
    const published: Array<{ uri: string; count: number }> = [];
    const manager = new DiagnosticsManager({
      publish: (uri, diagnostics) => published.push({ uri, count: diagnostics.length }),
      textProvider: () => "const App = () => null\n",
      // Compare by URI so the predicate is stable across the fsPath <-> URI
      // round-trip on every platform (App.tsx is "open").
      isOpen: (fsPath) => toUri(fsPath) === openUri,
    });

    // Interactive (overlay) scan publishes the open buffer's diagnostics.
    manager.applyOutcome(
      outcome({
        request: { ...request, priority: "interactive" },
        byFile: new Map([[FS_PATH, [diagnostic()]]]),
      }),
    );
    expect(manager.get(openUri).length).toBe(1);
    published.length = 0;

    // A background whole-project audit reports the file clean from disk —
    // it must NOT clear the open buffer's diagnostics.
    manager.applyOutcome(
      outcome({
        request: { ...request, priority: "background" },
        byFile: new Map(),
        coversProject: true,
        requestedPaths: [],
      }),
    );
    expect(manager.get(openUri).length).toBe(1);
    expect(published.some((entry) => entry.uri === openUri && entry.count === 0)).toBe(false);
  });
});

describe("DiagnosticsManager.retainProjectFiles", () => {
  it("clears tracked files that left the live set but keeps live ones", () => {
    const { manager, cleared } = createManager();
    const other = "/proj/src/Other.tsx";
    manager.applyOutcome(
      outcome({
        byFile: new Map([
          [FS_PATH, [diagnostic()]],
          [other, [diagnostic()]],
        ]),
        requestedPaths: [FS_PATH, other],
      }),
    );
    cleared.length = 0;

    // App.tsx left the enumeration (e.g. gitignored); Other.tsx stays live.
    manager.retainProjectFiles("/proj", [other]);

    expect(manager.get(toUri(FS_PATH)).length).toBe(0); // dropped → cleared
    expect(manager.get(toUri(other)).length).toBe(1); // live → kept
    expect(cleared).toContain(toUri(FS_PATH));
    expect(cleared).not.toContain(toUri(other));
  });
});
