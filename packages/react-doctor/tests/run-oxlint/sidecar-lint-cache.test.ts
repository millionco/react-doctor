import readinessFixture from "../../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/native-iframe-readiness.fixtures.json";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, createOxlintSpawnSlots, runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject, writeFile } from "../regressions/_helpers.js";

const realSpawn = childProcess.spawn;
const realSpawnObserver = vi
  .spyOn(childProcess, "spawn")
  .mockImplementation((...argumentsList: Parameters<typeof realSpawn>) => {
    const worker = realSpawn(...argumentsList);
    if (worker.send) vi.spyOn(worker, "send");
    return worker;
  });
syncBuiltinESMExports();

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-cache-e2e-"));

afterAll(() => {
  for (const result of realSpawnObserver.mock.results) {
    if (result.type === "return" && result.value.send && vi.isMockFunction(result.value.send))
      vi.mocked(result.value.send).mockRestore();
  }
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
    "react-doctor/no-array-index-as-key": "warn",
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
    if (result.value.send && !vi.isMockFunction(result.value.send)) vi.spyOn(result.value, "send");
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

describe("OIDC native-storage facade dependency cache", () => {
  it("matches cache-off after same-size provider edits and SDK alias creation/deletion", async () => {
    const providerSource = `import {UserManager,WebStorageStateStore} from "oidc-client";
const settings={userStore:new WebStorageStateStore({store:window.localStorage})};
export const manager=new UserManager(settings);
`;
    const customSource = `import {UserManager,WebStorageStateStore} from "oidc-client";
const settings={userStore:{get:()=>Promise.resolve(null)}};
export const manager=new UserManager(settings);
`;
    const projectDir = setupReactProject(tempRoot, "oidc-storage-facade", {
      files: {
        "src/AccountPanel.tsx": `import {useEffect,useState} from "react";
import {manager} from "./session";
export const AccountPanel=()=>{const [user,setUser]=useState(null);useEffect(()=>{manager.getUser().then(setUser)},[]);return <output>{user?.name}</output>};
`,
        "src/session.ts": providerSource,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "oidc-client": ["./sdk"] } },
        }),
      },
    });
    fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
    const scanAccount = (cached: boolean) =>
      runOxlint({
        rootDirectory: projectDir,
        project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
        userConfig: {
          rules: { "react-doctor/no-promise-then-side-effect-in-effect-without-catch": "warn" },
        },
        perFileLintCacheEnabled: cached,
        sidecarLintCacheEnabled: cached,
      });
    const assertPhase = async (expectedCount: number) => {
      const incremental = await scanAccount(true);
      const full = await scanAccount(false);
      expect(serialize(incremental)).toBe(serialize(full));
      expect(
        ruleHitsOn(
          full,
          "no-promise-then-side-effect-in-effect-without-catch",
          "src/AccountPanel.tsx",
        ),
      ).toHaveLength(expectedCount);
    };
    const providerPath = path.join(projectDir, "src/session.ts");
    const fixedTime = new Date("2025-01-01T00:00:00.000Z");
    fs.utimesSync(providerPath, fixedTime, fixedTime);
    await assertPhase(1);
    await scanAccount(true);
    const originalStat = fs.statSync(providerPath);
    expect(customSource.length).toBeLessThan(providerSource.length);
    fs.writeFileSync(providerPath, customSource.padEnd(providerSource.length, " "));
    fs.utimesSync(providerPath, originalStat.atime, originalStat.mtime);
    expect(fs.statSync(providerPath).size).toBe(originalStat.size);
    expect(fs.statSync(providerPath).mtimeMs).toBe(originalStat.mtimeMs);
    await assertPhase(0);
    fs.writeFileSync(providerPath, providerSource);
    fs.utimesSync(providerPath, originalStat.atime, originalStat.mtime);
    await assertPhase(1);
    const remapPath = path.join(projectDir, "sdk.ts");
    writeFile(remapPath, "export class UserManager {};\n");
    await assertPhase(0);
    fs.unlinkSync(remapPath);
    await assertPhase(1);
    const consumerPath = path.join(projectDir, "src/AccountPanel.tsx");
    const unchangedAliasConsumer =
      fs.readFileSync(consumerPath, "utf8") +
      'import {alternate} from "./alias"; const readAlias=()=>alternate.getUser();';
    fs.writeFileSync(consumerPath, unchangedAliasConsumer);
    await assertPhase(1);
    await scanAccount(true);
    const aliasPath = path.join(projectDir, "src/alias.ts");
    writeFile(aliasPath, 'export {manager as alternate} from "./session";\n');
    await assertPhase(0);
    fs.unlinkSync(aliasPath);
    await assertPhase(1);
    expect(fs.readFileSync(consumerPath, "utf8")).toBe(unchangedAliasConsumer);
  });
});

interface InheritedStringCacheCase {
  name: string;
  operation: "content" | "delete" | "appear" | "config" | "same-size";
  beforeWarnings: number;
  afterWarnings: number;
}

const INHERITED_STRING_CACHE_CASES: InheritedStringCacheCase[] = [
  { name: "provider contents change", operation: "content", beforeWarnings: 0, afterWarnings: 1 },
  { name: "provider disappears", operation: "delete", beforeWarnings: 0, afterWarnings: 1 },
  { name: "provider appears", operation: "appear", beforeWarnings: 1, afterWarnings: 0 },
  {
    name: "tsconfig alias target changes",
    operation: "config",
    beforeWarnings: 0,
    afterWarnings: 1,
  },
  {
    name: "same-size provider changes with its timestamp restored",
    operation: "same-size",
    beforeWarnings: 0,
    afterWarnings: 1,
  },
];

const STRING_TOKEN_FIELDS = "export interface TokenFields { value: string; }\n";
const NUMBER_TOKEN_FIELDS = "export interface TokenFields { value: number; }\n";
const INHERITED_STRING_TOKEN_VIEW = `import type { TokenFields } from "@tokens/schema";
interface TokenViewProps extends TokenFields {}
export const TokenView = ({ value }: TokenViewProps) => (
  <p>{value.split(/([,;])/g).map((part, index) => <span key={index}>{part}</span>)}</p>
);
`;

describe("inherited string token sidecar dependencies", () => {
  it.each(INHERITED_STRING_CACHE_CASES)(
    "$name invalidates an unchanged consumer at the next scan boundary",
    async ({ operation, beforeWarnings, afterWarnings }) => {
      const projectDir = setupFixture(`inherited-string-${operation}`);
      const consumerPath = path.join(projectDir, "src/TokenView.tsx");
      const providerPath = path.join(projectDir, "src/token-fields.ts");
      const aliasConfigPath = path.join(projectDir, "tsconfig.tokens.json");
      const preservedTimestamp = new Date("2025-01-01T00:00:00.000Z");
      writeFile(consumerPath, INHERITED_STRING_TOKEN_VIEW);
      writeFile(path.join(projectDir, "src/numeric-fields.ts"), NUMBER_TOKEN_FIELDS);
      writeFile(
        path.join(projectDir, "tsconfig.json"),
        JSON.stringify({
          extends: "./tsconfig.tokens.json",
          compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
        }),
      );
      writeFile(
        aliasConfigPath,
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@tokens/schema": ["src/token-fields.ts"] } },
        }),
      );
      if (operation !== "appear") writeFile(providerPath, STRING_TOKEN_FIELDS);
      if (operation === "same-size") {
        expect(Buffer.byteLength(STRING_TOKEN_FIELDS)).toBe(Buffer.byteLength(NUMBER_TOKEN_FIELDS));
        fs.utimesSync(providerPath, preservedTimestamp, preservedTimestamp);
      }

      const before = await scan(projectDir);
      expect(ruleHitsOn(before, "no-array-index-as-key", "src/TokenView.tsx")).toHaveLength(
        beforeWarnings,
      );
      let warmReplayed = 0;
      let warmConsidered = 0;
      const warm = await scan(projectDir, {
        onSidecarStats: (replayedFileCount, consideredFileCount) => {
          warmReplayed = replayedFileCount;
          warmConsidered = consideredFileCount;
        },
      });
      expect(serialize(warm)).toBe(serialize(before));
      expect(ruleHitsOn(warm, "no-array-index-as-key", "src/TokenView.tsx")).toHaveLength(
        beforeWarnings,
      );
      expect(warmConsidered).toBeGreaterThan(0);
      expect(warmReplayed).toBe(warmConsidered);

      if (operation === "delete") {
        fs.unlinkSync(providerPath);
      } else if (operation === "config") {
        writeFile(
          aliasConfigPath,
          JSON.stringify({
            compilerOptions: {
              baseUrl: ".",
              paths: { "@tokens/schema": ["src/numeric-fields.ts"] },
            },
          }),
        );
      } else {
        writeFile(providerPath, operation === "appear" ? STRING_TOKEN_FIELDS : NUMBER_TOKEN_FIELDS);
        if (operation === "same-size") {
          fs.utimesSync(providerPath, preservedTimestamp, preservedTimestamp);
          expect(fs.statSync(providerPath).mtimeMs).toBe(preservedTimestamp.getTime());
          expect(fs.statSync(providerPath).size).toBe(Buffer.byteLength(STRING_TOKEN_FIELDS));
        }
      }
      expect(fs.readFileSync(consumerPath, "utf8")).toBe(INHERITED_STRING_TOKEN_VIEW);

      let replayed = 0;
      let considered = 0;
      const incremental = await scan(projectDir, {
        onSidecarStats: (replayedFileCount, consideredFileCount) => {
          replayed = replayedFileCount;
          considered = consideredFileCount;
        },
      });
      expect(ruleHitsOn(incremental, "no-array-index-as-key", "src/TokenView.tsx")).toHaveLength(
        afterWarnings,
      );
      const full = await scanFull(projectDir);
      expect(ruleHitsOn(full, "no-array-index-as-key", "src/TokenView.tsx")).toHaveLength(
        afterWarnings,
      );
      expect(serialize(incremental)).toBe(serialize(full));
      expect(considered).toBeGreaterThan(0);
      expect(replayed).toBeGreaterThan(0);
      expect(replayed).toBeLessThan(considered);
    },
  );
});

interface FormFacadeCacheCase {
  name: string;
  operation: "same-size" | "delete" | "shadow" | "alias";
  relativeWarnings: number;
  aliasWarnings: number;
}

const FORM_FACADE_CACHE_CASES: FormFacadeCacheCase[] = [
  {
    name: "same-size facade mutation and reversal",
    operation: "same-size",
    relativeWarnings: 1,
    aliasWarnings: 1,
  },
  {
    name: "facade deletion and reappearance",
    operation: "delete",
    relativeWarnings: 1,
    aliasWarnings: 1,
  },
  {
    name: "relative candidate appearance and removal",
    operation: "shadow",
    relativeWarnings: 1,
    aliasWarnings: 0,
  },
  {
    name: "tsconfig alias retarget and reversal",
    operation: "alias",
    relativeWarnings: 0,
    aliasWarnings: 1,
  },
];

const FORM_SAFE_FACADE = `import {createFormHook} from "@tanstack/react-form";
export const {withForm}=createFormHook({});
`;
const FORM_UNPROVEN_FACADE = `import {createFormHook} from "@tanstack/react-faux";
export const {withForm}=createFormHook({});
`;
const FORM_RELATIVE_CONSUMER = `import {useState} from "react";
import {withForm} from "./form";
const Form=withForm({render:()=>{useState(0);return <div/>}});
export const RelativePanel=()=><Form/>;
`;
const FORM_ALIAS_CONSUMER = `import {useState} from "react";
import {withForm} from "@forms/api";
const Form=withForm({render:()=>{useState(0);return <div/>}});
export const AliasPanel=()=><Form/>;
`;
const FORM_RULE_ID = "rules-of-hooks";
const FORM_RELATIVE_CONSUMER_PATH = "src/RelativePanel.tsx";
const FORM_ALIAS_CONSUMER_PATH = "src/AliasPanel.tsx";
const FORM_SCAN_CONCURRENCY = 1;
const FORM_PRESERVED_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z");

const scanFormFacade = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
    userConfig: { rules: { ...USER_CONFIG.rules, "react-doctor/rules-of-hooks": "warn" } },
    concurrency: FORM_SCAN_CONCURRENCY,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });

const formAliasConfig = (target: string): string =>
  JSON.stringify({
    compilerOptions: {
      jsx: "preserve",
      strict: false,
      target: "es2022",
      module: "esnext",
      baseUrl: ".",
      paths: { "@forms/api": [target] },
    },
  });

describe("TanStack form facade sidecar dependencies", () => {
  it.each(FORM_FACADE_CACHE_CASES)(
    "$name invalidates unchanged JSX consumers at a scan boundary",
    async ({ operation, relativeWarnings, aliasWarnings }) => {
      const projectDir = setupFixture(`form-facade-${operation}`);
      const providerPath = path.join(projectDir, "src/form/index.ts");
      const shadowPath = path.join(projectDir, "src/form.ts");
      const configPath = path.join(projectDir, "tsconfig.forms.json");
      writeFile(
        path.join(projectDir, "tsconfig.json"),
        JSON.stringify({
          extends: "./tsconfig.forms.json",
          compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
        }),
      );
      writeFile(providerPath, FORM_SAFE_FACADE);
      writeFile(path.join(projectDir, "src/alternate-form.ts"), FORM_UNPROVEN_FACADE);
      writeFile(path.join(projectDir, FORM_RELATIVE_CONSUMER_PATH), FORM_RELATIVE_CONSUMER);
      writeFile(path.join(projectDir, FORM_ALIAS_CONSUMER_PATH), FORM_ALIAS_CONSUMER);
      writeFile(configPath, formAliasConfig("src/form/index.ts"));
      if (operation === "same-size") {
        expect(Buffer.byteLength(FORM_SAFE_FACADE)).toBe(Buffer.byteLength(FORM_UNPROVEN_FACADE));
        fs.utimesSync(providerPath, FORM_PRESERVED_TIMESTAMP, FORM_PRESERVED_TIMESTAMP);
      }

      const before = await scanFormFacade(projectDir);
      expect(ruleHitsOn(before, FORM_RULE_ID, FORM_RELATIVE_CONSUMER_PATH)).toHaveLength(0);
      expect(ruleHitsOn(before, FORM_RULE_ID, FORM_ALIAS_CONSUMER_PATH)).toHaveLength(0);
      let warmReplayed = 0;
      let warmConsidered = 0;
      const warm = await scanFormFacade(projectDir, {
        onSidecarStats: (replayedFileCount, consideredFileCount) => {
          warmReplayed = replayedFileCount;
          warmConsidered = consideredFileCount;
        },
      });
      expect(serialize(warm)).toBe(serialize(before));
      expect(warmConsidered).toBeGreaterThan(0);
      expect(warmReplayed).toBe(warmConsidered);

      if (operation === "delete") fs.unlinkSync(providerPath);
      else if (operation === "shadow") writeFile(shadowPath, FORM_UNPROVEN_FACADE);
      else if (operation === "alias")
        writeFile(configPath, formAliasConfig("src/alternate-form.ts"));
      else {
        writeFile(providerPath, FORM_UNPROVEN_FACADE);
        fs.utimesSync(providerPath, FORM_PRESERVED_TIMESTAMP, FORM_PRESERVED_TIMESTAMP);
        expect(fs.statSync(providerPath).mtimeMs).toBe(FORM_PRESERVED_TIMESTAMP.getTime());
        expect(fs.statSync(providerPath).size).toBe(Buffer.byteLength(FORM_SAFE_FACADE));
      }
      expect(fs.readFileSync(path.join(projectDir, FORM_RELATIVE_CONSUMER_PATH), "utf8")).toBe(
        FORM_RELATIVE_CONSUMER,
      );
      expect(fs.readFileSync(path.join(projectDir, FORM_ALIAS_CONSUMER_PATH), "utf8")).toBe(
        FORM_ALIAS_CONSUMER,
      );
      let replayed = 0;
      let considered = 0;
      const incremental = await scanFormFacade(projectDir, {
        onSidecarStats: (replayedFileCount, consideredFileCount) => {
          replayed = replayedFileCount;
          considered = consideredFileCount;
        },
      });
      const full = await scanFormFacade(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(ruleHitsOn(incremental, FORM_RULE_ID, FORM_RELATIVE_CONSUMER_PATH)).toHaveLength(
        relativeWarnings,
      );
      expect(ruleHitsOn(incremental, FORM_RULE_ID, FORM_ALIAS_CONSUMER_PATH)).toHaveLength(
        aliasWarnings,
      );
      expect(ruleHitsOn(full, FORM_RULE_ID, FORM_RELATIVE_CONSUMER_PATH)).toHaveLength(
        relativeWarnings,
      );
      expect(ruleHitsOn(full, FORM_RULE_ID, FORM_ALIAS_CONSUMER_PATH)).toHaveLength(aliasWarnings);
      expect(serialize(incremental)).toBe(serialize(full));
      expect(considered).toBeGreaterThan(0);
      expect(replayed).toBeGreaterThan(0);
      expect(replayed).toBeLessThan(considered);

      if (operation === "shadow") fs.unlinkSync(shadowPath);
      else if (operation === "alias") writeFile(configPath, formAliasConfig("src/form/index.ts"));
      else {
        writeFile(providerPath, FORM_SAFE_FACADE);
        if (operation === "same-size")
          fs.utimesSync(providerPath, FORM_PRESERVED_TIMESTAMP, FORM_PRESERVED_TIMESTAMP);
      }
      const reversed = await scanFormFacade(projectDir);
      const reversedFull = await scanFormFacade(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(ruleHitsOn(reversed, FORM_RULE_ID, FORM_RELATIVE_CONSUMER_PATH)).toHaveLength(0);
      expect(ruleHitsOn(reversed, FORM_RULE_ID, FORM_ALIAS_CONSUMER_PATH)).toHaveLength(0);
      expect(ruleHitsOn(reversedFull, FORM_RULE_ID, FORM_RELATIVE_CONSUMER_PATH)).toHaveLength(0);
      expect(ruleHitsOn(reversedFull, FORM_RULE_ID, FORM_ALIAS_CONSUMER_PATH)).toHaveLength(0);
      expect(serialize(reversed)).toBe(serialize(reversedFull));
      expect(fs.readFileSync(path.join(projectDir, FORM_RELATIVE_CONSUMER_PATH), "utf8")).toBe(
        FORM_RELATIVE_CONSUMER,
      );
      expect(fs.readFileSync(path.join(projectDir, FORM_ALIAS_CONSUMER_PATH), "utf8")).toBe(
        FORM_ALIAS_CONSUMER,
      );
    },
  );
});
interface SupabaseFactoryCacheCase {
  name: string;
  operation: "same-size" | "delete" | "shadow" | "alias" | "sdk-appear";
  relativeWarnings: number;
  aliasWarnings: number;
}

const SUPABASE_FACTORY_CACHE_CASES: SupabaseFactoryCacheCase[] = [
  {
    name: "equal-size factory to Hook and back",
    operation: "same-size",
    relativeWarnings: 1,
    aliasWarnings: 1,
  },
  {
    name: "provider deletion and reappearance",
    operation: "delete",
    relativeWarnings: 1,
    aliasWarnings: 1,
  },
  {
    name: "negative relative candidate appearance and removal",
    operation: "shadow",
    relativeWarnings: 1,
    aliasWarnings: 0,
  },
  {
    name: "extended alias retarget and reversal",
    operation: "alias",
    relativeWarnings: 0,
    aliasWarnings: 1,
  },
  {
    name: "negative SDK alias candidate appearance and removal",
    operation: "sdk-appear",
    relativeWarnings: 1,
    aliasWarnings: 1,
  },
];

const SUPABASE_FACTORY_PROVIDER = `import { createServerClient } from "@supabase/ssr";
export default function useRequestClient(cookieStore) {
  return createServerClient(process.env.PUBLIC_SERVICE_URL!, process.env.PUBLIC_SERVICE_KEY!, {
    cookies: { get(name) { return cookieStore.get(name)?.value; } },
  });
}
`;
const SUPABASE_HOOK_PROVIDER = `import { useState } from "react";
export default function useRequestClient(cookieStore) {
  return useState(0);
}
`;
const SUPABASE_PROVIDER_BYTE_LENGTH = Math.max(
  Buffer.byteLength(SUPABASE_FACTORY_PROVIDER),
  Buffer.byteLength(SUPABASE_HOOK_PROVIDER),
);
const SUPABASE_PADDED_FACTORY = SUPABASE_FACTORY_PROVIDER.padEnd(SUPABASE_PROVIDER_BYTE_LENGTH);
const SUPABASE_PADDED_HOOK = SUPABASE_HOOK_PROVIDER.padEnd(SUPABASE_PROVIDER_BYTE_LENGTH);
const SUPABASE_RELATIVE_CONSUMER = `import { cookies } from "next/headers";
import useRequestClient from "./request-client";
export const loadRequestData = async () => {
  const cookieStore = cookies();
  return useRequestClient(cookieStore);
};
`;
const SUPABASE_ALIAS_CONSUMER = `import { cookies } from "next/headers";
import useRequestClient from "@request/client";
export const loadRequestData = async () => {
  const cookieStore = cookies();
  return useRequestClient(cookieStore);
};
`;
const SUPABASE_RELATIVE_CONSUMER_PATH = "src/RelativeRequest.tsx";
const SUPABASE_ALIAS_CONSUMER_PATH = "src/AliasRequest.tsx";
const SUPABASE_PRESERVED_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z");
const SUPABASE_SCAN_CONCURRENCY = 1;

const supabaseAliasConfig = (target: string): string =>
  JSON.stringify({
    compilerOptions: {
      jsx: "preserve",
      strict: false,
      target: "es2022",
      module: "esnext",
      baseUrl: ".",
      paths: {
        "@request/client": [target],
        "@supabase/ssr": ["src/local-sdk"],
      },
    },
  });

const scanSupabaseFactory = (
  projectDir: string,
  options: ScanOptions = {},
): Promise<Diagnostic[]> => {
  observedRealWorkers();
  return runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({
      rootDirectory: projectDir,
      framework: "nextjs",
      nextjsVersion: "14.2.35",
      nextjsMajorVersion: 14,
    }),
    userConfig: { rules: { ...USER_CONFIG.rules, "react-doctor/rules-of-hooks": "warn" } },
    nodeBinaryPath: process.execPath,
    concurrency: SUPABASE_SCAN_CONCURRENCY,
    spawnSlots: createOxlintSpawnSlots(SUPABASE_SCAN_CONCURRENCY),
    adoptExistingLintConfig: false,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });
};

describe("Supabase factory native worker cache dependencies", () => {
  it.each(SUPABASE_FACTORY_CACHE_CASES)(
    "$name keeps one real worker and complete cache parity",
    async ({ operation, relativeWarnings, aliasWarnings }) => {
      const projectDir = setupFixture(`supabase-factory-${operation}`);
      const providerPath = path.join(projectDir, "src/request-client/index.ts");
      const shadowPath = path.join(projectDir, "src/request-client.ts");
      const localSdkPath = path.join(projectDir, "src/local-sdk.ts");
      const configPath = path.join(projectDir, "tsconfig.request.json");
      writeFile(
        path.join(projectDir, "package.json"),
        JSON.stringify({
          name: `supabase-factory-${operation}`,
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0",
            next: "14.2.35",
            "@supabase/ssr": "^0.0.10",
          },
        }),
      );
      writeFile(
        path.join(projectDir, "tsconfig.json"),
        JSON.stringify({
          extends: "./tsconfig.request.json",
          compilerOptions: { jsx: "preserve", strict: false, target: "es2022", module: "esnext" },
        }),
      );
      writeFile(configPath, supabaseAliasConfig("src/request-client/index.ts"));
      writeFile(providerPath, SUPABASE_PADDED_FACTORY);
      writeFile(path.join(projectDir, "src/alternate-client.ts"), SUPABASE_PADDED_HOOK);
      writeFile(path.join(projectDir, SUPABASE_RELATIVE_CONSUMER_PATH), SUPABASE_RELATIVE_CONSUMER);
      writeFile(path.join(projectDir, SUPABASE_ALIAS_CONSUMER_PATH), SUPABASE_ALIAS_CONSUMER);
      if (operation === "same-size") {
        expect(Buffer.byteLength(SUPABASE_PADDED_FACTORY)).toBe(
          Buffer.byteLength(SUPABASE_PADDED_HOOK),
        );
        fs.utimesSync(providerPath, SUPABASE_PRESERVED_TIMESTAMP, SUPABASE_PRESERVED_TIMESTAMP);
      }
      const nativeWorkers = () =>
        observedRealWorkers().filter((worker) => {
          if (!worker.send || !vi.isMockFunction(worker.send)) return false;
          const sentToFixture = vi
            .mocked(worker.send)
            .mock.calls.some(
              ([message]) =>
                typeof message === "object" &&
                message !== null &&
                "cwd" in message &&
                message.cwd === projectDir &&
                "type" in message &&
                (message.type === "job" || message.type === "probes"),
            );
          return sentToFixture;
        });
      const baselineFull = await scanSupabaseFactory(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      const before = await scanSupabaseFactory(projectDir);
      expect(serialize(before)).toBe(serialize(baselineFull));
      expect(ruleHitsOn(before, "rules-of-hooks", SUPABASE_RELATIVE_CONSUMER_PATH)).toHaveLength(0);
      expect(ruleHitsOn(before, "rules-of-hooks", SUPABASE_ALIAS_CONSUMER_PATH)).toHaveLength(0);
      expect(nativeWorkers()).toHaveLength(1);
      const selectedWorker = nativeWorkers()[0];
      const selectedWorkerSends = selectedWorker?.send ? vi.mocked(selectedWorker.send) : undefined;
      expect(selectedWorkerSends).toBeDefined();
      expect(selectedWorker?.pid).toBeGreaterThan(0);
      const workerPid = selectedWorker?.pid;
      let warmReplayed = 0;
      let warmConsidered = 0;
      const warm = await scanSupabaseFactory(projectDir, {
        onSidecarStats: (replayed, considered) => {
          warmReplayed = replayed;
          warmConsidered = considered;
        },
      });
      expect(serialize(warm)).toBe(serialize(before));
      expect(warmConsidered).toBeGreaterThan(0);
      expect(warmReplayed).toBe(warmConsidered);
      if (operation === "delete") fs.unlinkSync(providerPath);
      else if (operation === "shadow") writeFile(shadowPath, SUPABASE_PADDED_HOOK);
      else if (operation === "alias")
        writeFile(configPath, supabaseAliasConfig("src/alternate-client.ts"));
      else if (operation === "sdk-appear")
        writeFile(localSdkPath, 'export { useState as createServerClient } from "react";\n');
      else {
        writeFile(providerPath, SUPABASE_PADDED_HOOK);
        fs.utimesSync(providerPath, SUPABASE_PRESERVED_TIMESTAMP, SUPABASE_PRESERVED_TIMESTAMP);
        expect(fs.statSync(providerPath).mtimeMs).toBe(SUPABASE_PRESERVED_TIMESTAMP.getTime());
        expect(fs.statSync(providerPath).size).toBe(SUPABASE_PROVIDER_BYTE_LENGTH);
      }
      let replayed = 0;
      let considered = 0;
      const incremental = await scanSupabaseFactory(projectDir, {
        onSidecarStats: (replayedFiles, consideredFiles) => {
          replayed = replayedFiles;
          considered = consideredFiles;
        },
      });
      const full = await scanSupabaseFactory(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(
        ruleHitsOn(incremental, "rules-of-hooks", SUPABASE_RELATIVE_CONSUMER_PATH),
      ).toHaveLength(relativeWarnings);
      expect(ruleHitsOn(incremental, "rules-of-hooks", SUPABASE_ALIAS_CONSUMER_PATH)).toHaveLength(
        aliasWarnings,
      );
      expect(serialize(incremental)).toBe(serialize(full));
      expect(considered).toBeGreaterThan(0);
      expect(replayed).toBeGreaterThan(0);
      expect(replayed).toBeLessThan(considered);
      const changedWarm = await scanSupabaseFactory(projectDir);
      expect(serialize(changedWarm)).toBe(serialize(full));
      if (operation === "shadow") fs.unlinkSync(shadowPath);
      else if (operation === "sdk-appear") fs.unlinkSync(localSdkPath);
      else if (operation === "alias")
        writeFile(configPath, supabaseAliasConfig("src/request-client/index.ts"));
      else {
        writeFile(providerPath, SUPABASE_PADDED_FACTORY);
        if (operation === "same-size")
          fs.utimesSync(providerPath, SUPABASE_PRESERVED_TIMESTAMP, SUPABASE_PRESERVED_TIMESTAMP);
      }
      const reversed = await scanSupabaseFactory(projectDir);
      const reversedFull = await scanSupabaseFactory(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(ruleHitsOn(reversed, "rules-of-hooks", SUPABASE_RELATIVE_CONSUMER_PATH)).toHaveLength(
        0,
      );
      expect(ruleHitsOn(reversed, "rules-of-hooks", SUPABASE_ALIAS_CONSUMER_PATH)).toHaveLength(0);
      expect(serialize(reversed)).toBe(serialize(reversedFull));
      expect(nativeWorkers()).toEqual([selectedWorker]);
      expect(nativeWorkers()[0]?.pid).toBe(workerPid);
      expect(selectedWorker?.connected).toBe(true);
      expect(selectedWorker?.exitCode).toBeNull();
      expect(selectedWorker?.signalCode).toBeNull();
      const sentEpochs = selectedWorkerSends?.mock.calls.flatMap(([message]) =>
        typeof message === "object" &&
        message !== null &&
        "cwd" in message &&
        message.cwd === projectDir &&
        "filesystemCacheEpoch" in message &&
        typeof message.filesystemCacheEpoch === "number"
          ? [message.filesystemCacheEpoch]
          : [],
      );
      expect(new Set(sentEpochs).size).toBeGreaterThan(1);
      expect(fs.readFileSync(path.join(projectDir, SUPABASE_RELATIVE_CONSUMER_PATH), "utf8")).toBe(
        SUPABASE_RELATIVE_CONSUMER,
      );
      expect(fs.readFileSync(path.join(projectDir, SUPABASE_ALIAS_CONSUMER_PATH), "utf8")).toBe(
        SUPABASE_ALIAS_CONSUMER,
      );
    },
  );
});

interface ReadinessCacheCase {
  readonly name: string;
  readonly operation:
    | "hook-content"
    | "frame-content"
    | "delete-hook"
    | "shadow-hook"
    | "sdk-appear";
}

const READINESS_CACHE_CASES: readonly ReadinessCacheCase[] = [
  { name: "same-size hook guard change", operation: "hook-content" },
  { name: "same-size native ref change", operation: "frame-content" },
  { name: "hook deletion and restoration", operation: "delete-hook" },
  { name: "immediate module shadow appearance", operation: "shadow-hook" },
  { name: "negative local SDK remap becomes present", operation: "sdk-appear" },
];
const READINESS_SCAN_CONCURRENCY = 1;
const READINESS_PRESERVED_TIMESTAMP = new Date("2025-01-01T00:00:00.000Z");
const READINESS_CONSUMER_PATH = "src/Panel.tsx";
const READINESS_RULE = "no-reset-all-state-on-prop-change";

const scanNativeReadiness = (
  projectDir: string,
  options: ScanOptions = {},
): Promise<Diagnostic[]> => {
  observedRealWorkers();
  return runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "vite" }),
    userConfig: { rules: { ...USER_CONFIG.rules, [`react-doctor/${READINESS_RULE}`]: "warn" } },
    nodeBinaryPath: process.execPath,
    concurrency: READINESS_SCAN_CONCURRENCY,
    spawnSlots: createOxlintSpawnSlots(READINESS_SCAN_CONCURRENCY),
    adoptExistingLintConfig: false,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });
};

describe("native readiness module dependencies in one pooled worker", () => {
  it.each(READINESS_CACHE_CASES)(
    "$name preserves complete incremental diagnostics",
    async ({ operation }) => {
      const projectDir = setupFixture(`native-readiness-${operation}`);
      for (const [relativePath, contents] of Object.entries(readinessFixture.files)) {
        writeFile(
          path.join(
            projectDir,
            relativePath === "package.json" ? relativePath : `src/${relativePath}`,
          ),
          contents,
        );
      }
      const hookPath = path.join(projectDir, "src/channel/index.ts");
      const framePath = path.join(projectDir, "src/Frame.tsx");
      const shadowPath = path.join(projectDir, "src/channel.ts");
      const localSdkPath = path.join(projectDir, "src/local-ui.ts");
      writeFile(
        path.join(projectDir, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            jsx: "preserve",
            target: "es2022",
            module: "esnext",
            baseUrl: ".",
            paths: { "@sanity/ui": ["src/local-ui"] },
          },
        }),
      );
      const originalHook = fs.readFileSync(hookPath, "utf8");
      const originalFrame = fs.readFileSync(framePath, "utf8");
      const changedPath = operation === "frame-content" ? framePath : hookPath;
      if (operation === "hook-content" || operation === "frame-content") {
        fs.utimesSync(changedPath, READINESS_PRESERVED_TIMESTAMP, READINESS_PRESERVED_TIMESTAMP);
      }
      const nativeWorkers = () =>
        observedRealWorkers().filter((worker) => {
          if (!worker.send || !vi.isMockFunction(worker.send)) return false;
          const belongsToFixture = vi
            .mocked(worker.send)
            .mock.calls.some(
              ([message]) =>
                typeof message === "object" &&
                message !== null &&
                "cwd" in message &&
                message.cwd === projectDir &&
                "type" in message &&
                (message.type === "job" || message.type === "probes"),
            );
          return belongsToFixture;
        });
      const beforeFull = await scanNativeReadiness(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      const before = await scanNativeReadiness(projectDir);
      expect(serialize(before)).toBe(serialize(beforeFull));
      expect(ruleHitsOn(before, READINESS_RULE, READINESS_CONSUMER_PATH)).toHaveLength(0);
      expect(nativeWorkers()).toHaveLength(1);
      const selectedWorker = nativeWorkers()[0];
      const selectedWorkerSends = selectedWorker?.send ? vi.mocked(selectedWorker.send) : undefined;
      expect(selectedWorkerSends).toBeDefined();
      expect(selectedWorker?.pid).toBeGreaterThan(0);
      let warmReplayed = 0;
      let warmConsidered = 0;
      const warm = await scanNativeReadiness(projectDir, {
        onSidecarStats: (replayed, considered) => {
          warmReplayed = replayed;
          warmConsidered = considered;
        },
      });
      expect(serialize(warm)).toBe(serialize(before));
      expect(warmConsidered).toBeGreaterThan(0);
      expect(warmReplayed).toBe(warmConsidered);
      if (operation === "hook-content" || operation === "frame-content") {
        const original = operation === "hook-content" ? originalHook : originalFrame;
        const changed =
          operation === "hook-content"
            ? original.replace(
                "event.source!==frame?.contentWindow",
                "event.source===frame?.contentWindow",
              )
            : original.replace("ref={forwarded}", "ref={discarded}");
        expect(changed).not.toBe(original);
        expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(original));
        writeFile(changedPath, changed);
        fs.utimesSync(changedPath, READINESS_PRESERVED_TIMESTAMP, READINESS_PRESERVED_TIMESTAMP);
        expect(fs.statSync(changedPath).mtimeMs).toBe(READINESS_PRESERVED_TIMESTAMP.getTime());
      } else if (operation === "delete-hook") fs.unlinkSync(hookPath);
      else if (operation === "shadow-hook")
        writeFile(shadowPath, "export {useChannel} from './channel/index';");
      else writeFile(localSdkPath, "export const Card=customContainer;");
      let replayed = 0;
      let considered = 0;
      const incremental = await scanNativeReadiness(projectDir, {
        onSidecarStats: (replayedFiles, consideredFiles) => {
          replayed = replayedFiles;
          considered = consideredFiles;
        },
      });
      const full = await scanNativeReadiness(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(ruleHitsOn(incremental, READINESS_RULE, READINESS_CONSUMER_PATH)).toHaveLength(1);
      expect(serialize(incremental)).toBe(serialize(full));
      expect(considered).toBeGreaterThan(0);
      expect(replayed).toBeGreaterThan(0);
      expect(replayed).toBeLessThan(considered);
      expect(serialize(await scanNativeReadiness(projectDir))).toBe(serialize(full));
      if (operation === "shadow-hook") fs.unlinkSync(shadowPath);
      else if (operation === "sdk-appear") fs.unlinkSync(localSdkPath);
      else if (operation === "frame-content") writeFile(framePath, originalFrame);
      else writeFile(hookPath, originalHook);
      if (operation === "hook-content" || operation === "frame-content")
        fs.utimesSync(changedPath, READINESS_PRESERVED_TIMESTAMP, READINESS_PRESERVED_TIMESTAMP);
      const reversed = await scanNativeReadiness(projectDir);
      const reversedFull = await scanNativeReadiness(projectDir, {
        perFileLintCacheEnabled: false,
        sidecarLintCacheEnabled: false,
      });
      expect(ruleHitsOn(reversed, READINESS_RULE, READINESS_CONSUMER_PATH)).toHaveLength(0);
      expect(serialize(reversed)).toBe(serialize(reversedFull));
      expect(nativeWorkers()).toEqual([selectedWorker]);
      expect(selectedWorker?.connected).toBe(true);
      expect(selectedWorker?.exitCode).toBeNull();
      expect(selectedWorker?.signalCode).toBeNull();
      const epochs = selectedWorkerSends?.mock.calls.flatMap(([message]) =>
        typeof message === "object" &&
        message !== null &&
        "cwd" in message &&
        message.cwd === projectDir &&
        "filesystemCacheEpoch" in message &&
        typeof message.filesystemCacheEpoch === "number"
          ? [message.filesystemCacheEpoch]
          : [],
      );
      expect(new Set(epochs).size).toBeGreaterThan(1);
      expect(fs.readFileSync(path.join(projectDir, READINESS_CONSUMER_PATH), "utf8")).toBe(
        readinessFixture.files["Panel.tsx"],
      );
    },
  );
});
