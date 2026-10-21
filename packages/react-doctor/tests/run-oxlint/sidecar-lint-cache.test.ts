import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, createOxlintSpawnSlots, runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject, writeFile } from "../regressions/_helpers.js";

const realSpawnObserver = vi.spyOn(childProcess, "spawn");
syncBuiltinESMExports();

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-cache-e2e-"));

afterAll(() => {
  realSpawnObserver.mockRestore();
  syncBuiltinESMExports();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// Every scenario asserts INCREMENTAL ≡ FULL: after a mutation, a scan with
// both caches warm must produce byte-identical diagnostics to a from-scratch
// cache-off scan of the same tree — including the cases where a SIBLING edit
// must flip an unchanged file's cross-file verdict (the exact staleness class
// the dependency fingerprints exist to catch).
const USER_CONFIG = {
  rules: {
    "react-doctor/no-barrel-import": "warn",
    "react-doctor/no-mutating-reducer-state": "warn",
  },
} as const;

const INK_USER_CONFIG = {
  rules: {
    "react-doctor/ink-no-raw-text": "error",
  },
} as const;

const APP_SOURCE = `import { Button } from "./components";
export const App = () => <div><Button /></div>;
`;
const STORE_SOURCE = `import { useReducer } from "react";
import { listReducer } from "./listReducer";
export const useStore = () => useReducer(listReducer, { count: 0 });
`;
const MUTATING_REDUCER = `export const listReducer = (state, action) => {
  state.count += 1;
  return state;
};
`;
const PURE_REDUCER = `export const listReducer = (state, action) => ({ count: state.count + 1 });
`;

interface ScanOptions {
  perFileLintCacheEnabled?: boolean;
  sidecarLintCacheEnabled?: boolean;
  onSidecarStats?: (replayedFileCount: number, consideredFileCount: number) => void;
  onFileProgress?: (scannedFileCount: number, totalFileCount: number) => void;
}

const setupFixture = (caseId: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "src/components/Button.tsx": "export const Button = () => null;\n",
      "src/components/Card.tsx": "export const Card = () => null;\n",
      "src/components/index.ts":
        "export { Button } from './Button';\nexport { Card } from './Card';\n",
      "src/App.tsx": APP_SOURCE,
      "src/listReducer.ts": MUTATING_REDUCER,
      "src/Store.tsx": STORE_SOURCE,
      "src/clean.tsx": "export const Clean = () => <div>ok</div>;\n",
    },
  });
  // A `node_modules` directory makes the cache land inside the fixture
  // (cleaned up with `tempRoot`) instead of the OS temp dir.
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  return projectDir;
};

const scan = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
    userConfig: USER_CONFIG,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
    onFileProgress: options.onFileProgress,
  });

const scanFull = (projectDir: string): Promise<Diagnostic[]> =>
  scan(projectDir, { perFileLintCacheEnabled: false, sidecarLintCacheEnabled: false });

const setupInkFixture = (caseId: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "src/App.tsx": `import { Panel } from "./Panel";
export const App = () => <Panel>raw text</Panel>;
`,
      "src/Panel.tsx": `import { Box } from "ink";
export const Panel = ({ children }) => <Box>{children}</Box>;
`,
    },
  });
  writeFile(
    path.join(projectDir, "node_modules/ink/package.json"),
    `{ "name": "ink", "version": "7.1.1" }\n`,
  );
  return projectDir;
};

const scanInk = (projectDir: string, sidecarLintCacheEnabled: boolean): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
    userConfig: INK_USER_CONFIG,
    perFileLintCacheEnabled: false,
    sidecarLintCacheEnabled,
  });

const serialize = (diagnostics: ReadonlyArray<Diagnostic>): string =>
  JSON.stringify(
    [...diagnostics]
      .map((diagnostic) => ({ ...diagnostic }))
      .sort((first, second) =>
        buildDiagnosticIdentity(first).localeCompare(buildDiagnosticIdentity(second)),
      ),
  );

const ruleHitsOn = (
  diagnostics: ReadonlyArray<Diagnostic>,
  rule: string,
  filePath: string,
): ReadonlyArray<Diagnostic> =>
  diagnostics.filter((diagnostic) => diagnostic.rule === rule && diagnostic.filePath === filePath);

describe("sidecar lint cache", () => {
  it("reports file progress through to the full total when the sidecar replays files", async () => {
    const projectDir = setupFixture("progress-completes");
    await scan(projectDir);
    const progressReports: Array<readonly [number, number]> = [];
    await scan(projectDir, {
      onFileProgress: (scannedFileCount, totalFileCount) => {
        progressReports.push([scannedFileCount, totalFileCount]);
      },
    });

    const lastReport = progressReports.at(-1);
    expect(lastReport).toBeDefined();
    expect(lastReport?.[0]).toBe(lastReport?.[1]);
  });

  it("replays a fully unchanged tree and stays byte-identical to a full scan", async () => {
    const projectDir = setupFixture("unchanged-replay");
    const full = await scanFull(projectDir);
    const cold = await scan(projectDir);
    let replayed: number | null = null;
    let considered: number | null = null;
    const warm = await scan(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        replayed = replayedFileCount;
        considered = consideredFileCount;
      },
    });

    expect(serialize(cold)).toBe(serialize(full));
    expect(serialize(warm)).toBe(serialize(full));
    // Sanity: both cross-file rules actually fired.
    expect(full.some((diagnostic) => diagnostic.rule === "no-barrel-import")).toBe(true);
    expect(full.some((diagnostic) => diagnostic.rule === "no-mutating-reducer-state")).toBe(true);
    // Every cache-hit file replayed its sidecar diagnostics — no oxlint
    // sidecar pass ran at all on the warm scan.
    expect(considered).toBeGreaterThan(0);
    expect(replayed).toBe(considered);
  });

  it("flips an unchanged importer's verdict when the barrel stops being a barrel", async () => {
    const projectDir = setupFixture("barrel-flip");
    const before = await scan(projectDir);
    await scan(projectDir); // warm: App.tsx now replays from the sidecar store
    expect(ruleHitsOn(before, "no-barrel-import", "src/App.tsx")).toHaveLength(1);

    // Change ONLY the dependency: the index stops re-exporting (not a barrel).
    // App.tsx is byte-for-byte unchanged, so without the dependency probes it
    // would replay the stale "barrel" verdict.
    writeFile(
      path.join(projectDir, "src/components/index.ts"),
      "export const Button = () => null;\n",
    );
    const incremental = await scan(projectDir);
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, "no-barrel-import", "src/App.tsx")).toHaveLength(0);
  });

  it("flips an unchanged Ink importer's verdict when its wrapper changes", async () => {
    const projectDir = setupInkFixture("ink-wrapper-flip");
    const before = await scanInk(projectDir, true);
    await scanInk(projectDir, true);
    expect(ruleHitsOn(before, "ink-no-raw-text", "src/App.tsx")).toHaveLength(1);

    writeFile(
      path.join(projectDir, "src/Panel.tsx"),
      `import { Text } from "ink";
export const Panel = ({ children }) => <Text>{children}</Text>;
`,
    );
    const incremental = await scanInk(projectDir, true);
    const full = await scanInk(projectDir, false);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, "ink-no-raw-text", "src/App.tsx")).toHaveLength(0);
  });

  it("re-points the suggestion when the barrel's re-export target moves", async () => {
    const projectDir = setupFixture("barrel-retarget");
    await scan(projectDir);
    const warmBefore = await scan(projectDir);
    const suggestionBefore = ruleHitsOn(warmBefore, "no-barrel-import", "src/App.tsx")[0]?.message;
    expect(suggestionBefore).toContain("./components/Button");

    // The barrel now re-exports Button from a DIFFERENT file. App.tsx is
    // unchanged, but its diagnostic's direct-import suggestion must follow.
    writeFile(
      path.join(projectDir, "src/components/ButtonAlt.tsx"),
      "export const Button = () => null;\n",
    );
    writeFile(
      path.join(projectDir, "src/components/index.ts"),
      "export { Button } from './ButtonAlt';\nexport { Card } from './Card';\n",
    );
    const incremental = await scan(projectDir);
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, "no-barrel-import", "src/App.tsx")[0]?.message).toContain(
      "./components/ButtonAlt",
    );
  });

  it("re-resolves when a new file SHADOWS the barrel directory (negative probes)", async () => {
    const projectDir = setupFixture("resolution-shadowing");
    await scan(projectDir);
    const warmBefore = await scan(projectDir);
    expect(ruleHitsOn(warmBefore, "no-barrel-import", "src/App.tsx")).toHaveLength(1);

    // `./components` now resolves to this NEW file (extension candidates win
    // over the directory index). Nothing App.tsx read before changed — only a
    // previously-ABSENT resolution candidate appeared.
    writeFile(path.join(projectDir, "src/components.tsx"), "export const Button = () => null;\n");
    const incremental = await scan(projectDir);
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, "no-barrel-import", "src/App.tsx")).toHaveLength(0);
  });

  it("flips an unchanged consumer's verdict when its imported reducer is fixed", async () => {
    const projectDir = setupFixture("reducer-fix");
    const before = await scan(projectDir);
    await scan(projectDir);
    expect(ruleHitsOn(before, "no-mutating-reducer-state", "src/Store.tsx")).toHaveLength(1);

    // Fix the mutation in the OTHER file; Store.tsx is unchanged.
    writeFile(path.join(projectDir, "src/listReducer.ts"), PURE_REDUCER);
    const incremental = await scan(projectDir);
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, "no-mutating-reducer-state", "src/Store.tsx")).toHaveLength(0);
  });

  it("keeps replaying unaffected files when an unrelated file changes", async () => {
    const projectDir = setupFixture("unrelated-edit");
    await scan(projectDir);
    writeFile(
      path.join(projectDir, "src/clean.tsx"),
      "export const Clean = () => <div>still ok</div>;\n",
    );
    let replayed: number | null = null;
    let considered: number | null = null;
    const incremental = await scan(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        replayed = replayedFileCount;
        considered = consideredFileCount;
      },
    });
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    // The edited file is a per-file-cache MISS (not a sidecar candidate);
    // every remaining hit is a dependency-clean replay.
    expect(replayed).toBe(considered);
    expect(considered).toBeGreaterThan(0);
  });

  it("re-lints everything (correctly) when the sidecar store is corrupt", async () => {
    const projectDir = setupFixture("corrupt-store");
    await scan(projectDir);
    const storePath = path.join(
      projectDir,
      "node_modules",
      ".cache",
      "react-doctor",
      "sidecar-lint-cache.json",
    );
    expect(fs.existsSync(storePath)).toBe(true);
    fs.writeFileSync(storePath, "{ not json !!");

    let replayed: number | null = null;
    const incremental = await scan(projectDir, {
      onSidecarStats: (replayedFileCount) => {
        replayed = replayedFileCount;
      },
    });
    const full = await scanFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(replayed).toBe(0);
  });

  it("never consults the sidecar store when disabled (rollback hatch)", async () => {
    const projectDir = setupFixture("sidecar-disabled");
    let sidecarStatsCalled = false;
    await scan(projectDir, { sidecarLintCacheEnabled: false });
    const warm = await scan(projectDir, {
      sidecarLintCacheEnabled: false,
      onSidecarStats: () => {
        sidecarStatsCalled = true;
      },
    });
    const full = await scanFull(projectDir);

    expect(sidecarStatsCalled).toBe(false);
    expect(serialize(warm)).toBe(serialize(full));
    expect(
      fs.existsSync(
        path.join(projectDir, "node_modules", ".cache", "react-doctor", "sidecar-lint-cache.json"),
      ),
    ).toBe(false);
  });
});

interface SlateFocusCacheCase {
  name: string;
  facet: "facade" | "manifest";
  operation: "content" | "delete" | "appear" | "same-size";
}

const SLATE_FOCUS_CACHE_CASES: SlateFocusCacheCase[] = [
  { name: "facade content changes", facet: "facade", operation: "content" },
  { name: "facade disappears", facet: "facade", operation: "delete" },
  { name: "facade appears", facet: "facade", operation: "appear" },
  {
    name: "facade changes with equal size and restored timestamp",
    facet: "facade",
    operation: "same-size",
  },
  { name: "SDK declaration changes", facet: "manifest", operation: "content" },
  { name: "SDK declaration disappears", facet: "manifest", operation: "delete" },
  { name: "SDK declaration appears", facet: "manifest", operation: "appear" },
  {
    name: "SDK declaration changes with equal size and restored timestamp",
    facet: "manifest",
    operation: "same-size",
  },
];

const CURRENT_FOCUS_VIEW = `import { useEffect, useState } from "react";
import { FocusApi } from "./focus-api";
export const FocusPanel = ({ entity }: { entity: object }) => {
  const [focused, setFocused] = useState(FocusApi.isFocused(entity));
  useEffect(() => { setFocused(FocusApi.isFocused(entity)); }, [entity]);
  return <output>{String(focused)}</output>;
};
`;
const CURRENT_FOCUS_FACADE = `import { DOMEditor } from "slate-dom";
export const FocusApi = DOMEditor;
`;
const MUTABLE_FOCUS_FACADE = `import { DOMEditor } from "slate-dom";
export let   FocusApi = DOMEditor;
`;
const SUPPORTED_FOCUS_MANIFEST = '{"private":true,"dependencies":{"slate-dom":"^0.126.0"}}\n';
const UNSUPPORTED_FOCUS_MANIFEST = '{"private":true,"dependencies":{"slate-dom":"^0.127.0"}}\n';
const FOCUS_RULE_ID = "no-reset-all-state-on-prop-change";
const FOCUS_CONSUMER_PATH = "src/focus/FocusPanel.tsx";
const FOCUS_SCAN_CONCURRENCY = 1;
const FOCUS_SINGLE_WARNING_COUNT = 1;
const FOCUS_NO_WARNING_COUNT = 0;
const FOCUS_PRESERVED_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z");

const observedRealWorkers = () =>
  realSpawnObserver.mock.results.flatMap((result, resultIndex) => {
    const argumentsList = realSpawnObserver.mock.calls[resultIndex]?.[1];
    if (
      result.type !== "return" ||
      !Array.isArray(argumentsList) ||
      !argumentsList.some((argument) => path.basename(argument) === "oxlint-worker.js")
    )
      return [];
    return [result.value];
  });

const scanCurrentFocus = async (projectDir: string, options: ScanOptions = {}) => {
  const spawnSlots = createOxlintSpawnSlots(FOCUS_SCAN_CONCURRENCY);
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
    userConfig: {
      rules: {
        ...USER_CONFIG.rules,
        "react-doctor/no-reset-all-state-on-prop-change": "warn",
      },
    },
    concurrency: FOCUS_SCAN_CONCURRENCY,
    spawnSlots,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });
  return { diagnostics, filesystemCacheEpoch: spawnSlots.filesystemCacheEpoch };
};

const isCurrentFocusLintMessage = (
  message: unknown,
  projectDir: string,
  filesystemCacheEpoch: number,
): boolean =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "job" &&
  "cwd" in message &&
  message.cwd === projectDir &&
  "filesystemCacheEpoch" in message &&
  message.filesystemCacheEpoch === filesystemCacheEpoch &&
  "argumentsList" in message &&
  Array.isArray(message.argumentsList) &&
  message.argumentsList.some(
    (argument: unknown) => typeof argument === "string" && argument.endsWith("FocusPanel.tsx"),
  );

describe("slate current focus pooled sidecar dependencies", () => {
  it.each(SLATE_FOCUS_CACHE_CASES)(
    "$name invalidates the unchanged consumer on the same real worker",
    async ({ facet, operation }) => {
      const projectDir = setupFixture(`slate-focus-${facet}-${operation}`);
      const consumerPath = path.join(projectDir, FOCUS_CONSUMER_PATH);
      const facadePath = path.join(projectDir, "src/focus/focus-api.ts");
      const manifestPath = path.join(projectDir, "src/focus/package.json");
      const dependencyPath = facet === "facade" ? facadePath : manifestPath;
      const supportedContents =
        facet === "facade" ? CURRENT_FOCUS_FACADE : SUPPORTED_FOCUS_MANIFEST;
      const unsupportedContents =
        facet === "facade" ? MUTABLE_FOCUS_FACADE : UNSUPPORTED_FOCUS_MANIFEST;
      const beforeWarningCount =
        operation === "appear" ? FOCUS_SINGLE_WARNING_COUNT : FOCUS_NO_WARNING_COUNT;
      const afterWarningCount =
        operation === "appear" ? FOCUS_NO_WARNING_COUNT : FOCUS_SINGLE_WARNING_COUNT;
      writeFile(consumerPath, CURRENT_FOCUS_VIEW);
      writeFile(facadePath, CURRENT_FOCUS_FACADE);
      writeFile(manifestPath, SUPPORTED_FOCUS_MANIFEST);
      if (operation === "appear") fs.unlinkSync(dependencyPath);
      if (operation === "same-size") {
        expect(Buffer.byteLength(supportedContents)).toBe(Buffer.byteLength(unsupportedContents));
        fs.utimesSync(dependencyPath, FOCUS_PRESERVED_TIMESTAMP, FOCUS_PRESERVED_TIMESTAMP);
      }

      const before = await scanCurrentFocus(projectDir);
      expect(ruleHitsOn(before.diagnostics, FOCUS_RULE_ID, FOCUS_CONSUMER_PATH)).toHaveLength(
        beforeWarningCount,
      );
      const liveWorkers = observedRealWorkers().filter(
        (worker) => worker.connected && worker.exitCode === null && worker.signalCode === null,
      );
      expect(liveWorkers).toHaveLength(FOCUS_SCAN_CONCURRENCY);
      const worker = liveWorkers[0];
      if (worker === undefined) throw new Error("The real pooled worker was not observed");
      const workerPid = worker.pid;
      expect(workerPid).toBeGreaterThan(0);
      const workerCountBefore = observedRealWorkers().length;
      const realWorkerSends = vi.spyOn(worker, "send");
      try {
        let warmReplayed = 0;
        let warmConsidered = 0;
        const warm = await scanCurrentFocus(projectDir, {
          onSidecarStats: (replayedFileCount, consideredFileCount) => {
            warmReplayed = replayedFileCount;
            warmConsidered = consideredFileCount;
          },
        });
        expect(warm.filesystemCacheEpoch).not.toBe(before.filesystemCacheEpoch);
        expect(serialize(warm.diagnostics)).toBe(serialize(before.diagnostics));
        expect(warmConsidered).toBeGreaterThan(0);
        expect(warmReplayed).toBe(warmConsidered);

        if (operation === "delete") fs.unlinkSync(dependencyPath);
        else
          writeFile(
            dependencyPath,
            operation === "appear" ? supportedContents : unsupportedContents,
          );
        if (operation === "same-size") {
          fs.utimesSync(dependencyPath, FOCUS_PRESERVED_TIMESTAMP, FOCUS_PRESERVED_TIMESTAMP);
          expect(fs.statSync(dependencyPath).mtimeMs).toBe(FOCUS_PRESERVED_TIMESTAMP.getTime());
          expect(fs.statSync(dependencyPath).size).toBe(Buffer.byteLength(supportedContents));
        }
        expect(fs.readFileSync(consumerPath, "utf8")).toBe(CURRENT_FOCUS_VIEW);

        let replayed = 0;
        let considered = 0;
        const incremental = await scanCurrentFocus(projectDir, {
          onSidecarStats: (replayedFileCount, consideredFileCount) => {
            replayed = replayedFileCount;
            considered = consideredFileCount;
          },
        });
        expect(incremental.filesystemCacheEpoch).not.toBe(warm.filesystemCacheEpoch);
        expect(
          ruleHitsOn(incremental.diagnostics, FOCUS_RULE_ID, FOCUS_CONSUMER_PATH),
        ).toHaveLength(afterWarningCount);
        expect(
          realWorkerSends.mock.calls.some(([message]) =>
            isCurrentFocusLintMessage(message, projectDir, incremental.filesystemCacheEpoch),
          ),
        ).toBe(true);
        const full = await scanCurrentFocus(projectDir, {
          perFileLintCacheEnabled: false,
          sidecarLintCacheEnabled: false,
        });
        expect(full.filesystemCacheEpoch).not.toBe(incremental.filesystemCacheEpoch);
        expect(
          realWorkerSends.mock.calls.some(([message]) =>
            isCurrentFocusLintMessage(message, projectDir, full.filesystemCacheEpoch),
          ),
        ).toBe(true);
        expect(ruleHitsOn(full.diagnostics, FOCUS_RULE_ID, FOCUS_CONSUMER_PATH)).toHaveLength(
          afterWarningCount,
        );
        expect(serialize(incremental.diagnostics)).toBe(serialize(full.diagnostics));
        expect(considered).toBeGreaterThan(0);
        expect(replayed).toBeGreaterThan(0);
        expect(replayed).toBeLessThan(considered);
        expect(observedRealWorkers()).toHaveLength(workerCountBefore);
        expect(worker.pid).toBe(workerPid);
        expect(worker.connected).toBe(true);
        expect(worker.exitCode).toBeNull();
        expect(worker.signalCode).toBeNull();
      } finally {
        realWorkerSends.mockRestore();
      }
    },
  );
});
