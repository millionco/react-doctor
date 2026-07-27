import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, runOxlint } from "@react-doctor/core";
import { CROSS_FILE_RULE_IDS } from "oxlint-plugin-react-doctor";
import { buildTestProject, setupReactProject, writeFile } from "../regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-cache-e2e-"));

afterAll(() => {
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

const HYDRATION_RULE_ID = "no-unguarded-browser-global-in-render-or-hook-init";
const HYDRATION_USER_CONFIG = {
  rules: Object.fromEntries(
    [...CROSS_FILE_RULE_IDS].map((ruleId): [string, "error" | "off"] => [
      `react-doctor/${ruleId}`,
      ruleId === HYDRATION_RULE_ID ? "error" : "off",
    ]),
  ),
};
const NEXT_DYNAMIC_API_RULE_ID = "nextjs-async-dynamic-api-not-awaited";
const NEXT_DYNAMIC_API_USER_CONFIG = {
  rules: Object.fromEntries(
    [...CROSS_FILE_RULE_IDS].map((ruleId): [string, "error" | "off"] => [
      `react-doctor/${ruleId}`,
      ruleId === NEXT_DYNAMIC_API_RULE_ID ? "error" : "off",
    ]),
  ),
};
const NEXT_NO_IMG_RULE_ID = "nextjs-no-img-element";
const NEXT_NO_IMG_USER_CONFIG = {
  rules: Object.fromEntries(
    [...CROSS_FILE_RULE_IDS].map((ruleId): [string, "error" | "off"] => [
      `react-doctor/${ruleId}`,
      ruleId === NEXT_NO_IMG_RULE_ID ? "error" : "off",
    ]),
  ),
};

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
const FALSE_SERVER_SNAPSHOT_HOOK = `import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);
`;
// Preserve byte length so the dependency's content, not its size, must invalidate the replay.
const TRUE_SERVER_SNAPSHOT_HOOK = FALSE_SERVER_SNAPSHOT_HOOK.replace("() => false", "() =>  true");

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

const setupHydrationFixture = (caseId: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "src/App.tsx": `import { useClientReady as useHydrated } from "./hooks";
export const App = () => {
  const hydrated = useHydrated();
  return hydrated && <span>{document.title}</span>;
};
`,
      "src/hooks/index.ts": `export { useHydrated as useClientReady } from "../use-hydrated";\n`,
      "src/use-hydrated.ts": FALSE_SERVER_SNAPSHOT_HOOK,
      "src/clean.tsx": "export const Clean = () => <div>ok</div>;\n",
    },
    packageJsonExtras: {
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
    },
  });
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  return projectDir;
};

const scanHydration = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "nextjs" }),
    userConfig: HYDRATION_USER_CONFIG,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });

const scanHydrationFull = (projectDir: string): Promise<Diagnostic[]> =>
  scanHydration(projectDir, {
    perFileLintCacheEnabled: false,
    sidecarLintCacheEnabled: false,
  });

const setupNextDynamicApiFixture = (caseId: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "packages/app/app/page.tsx": `import { cookies } from "next/headers";
export default function Page() {
  return cookies().get("session");
}
`,
      "src/clean.tsx": "export const Clean = () => <div>ok</div>;\n",
    },
  });
  writeFile(
    path.join(projectDir, "packages/app/package.json"),
    `{ "name": "app", "dependencies": { "react": "19.0.0", "next": "15.0.0" } }\n`,
  );
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  return projectDir;
};

const scanNextDynamicApi = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "nextjs" }),
    userConfig: NEXT_DYNAMIC_API_USER_CONFIG,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });

const scanNextDynamicApiFull = (projectDir: string): Promise<Diagnostic[]> =>
  scanNextDynamicApi(projectDir, {
    perFileLintCacheEnabled: false,
    sidecarLintCacheEnabled: false,
  });

const setupNextImageFixture = (caseId: string): string => {
  const projectDir = setupReactProject(tempRoot, caseId, {
    files: {
      "lib/card.tsx": `export const Card = () => <img src="/social-card.png" alt="" />;\n`,
      "app/api/card/route.tsx": `import { ImageResponse } from "next/og";
import { Card } from "../../../lib/card";
export const GET = () => new ImageResponse(<Card />);
`,
    },
    packageJsonExtras: {
      dependencies: {
        next: "15.0.0",
        react: "19.0.0",
        "react-dom": "19.0.0",
      },
    },
  });
  fs.mkdirSync(path.join(projectDir, "node_modules"), { recursive: true });
  return projectDir;
};

const scanNextImage = (projectDir: string, options: ScanOptions = {}): Promise<Diagnostic[]> =>
  runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "nextjs" }),
    userConfig: NEXT_NO_IMG_USER_CONFIG,
    perFileLintCacheEnabled: options.perFileLintCacheEnabled ?? true,
    sidecarLintCacheEnabled: options.sidecarLintCacheEnabled ?? true,
    onSidecarStats: options.onSidecarStats,
  });

const scanNextImageFull = (projectDir: string): Promise<Diagnostic[]> =>
  scanNextImage(projectDir, {
    perFileLintCacheEnabled: false,
    sidecarLintCacheEnabled: false,
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

  it("invalidates an unchanged browser read when an imported server snapshot changes", async () => {
    const projectDir = setupHydrationFixture("imported-server-snapshot-flip");
    const before = await scanHydration(projectDir);
    let warmReplayed: number | null = null;
    let warmConsidered: number | null = null;
    await scanHydration(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        warmReplayed = replayedFileCount;
        warmConsidered = consideredFileCount;
      },
    });
    expect(ruleHitsOn(before, HYDRATION_RULE_ID, "src/App.tsx")).toHaveLength(0);
    expect(warmConsidered).toBeGreaterThan(0);
    expect(warmReplayed).toBe(warmConsidered);

    writeFile(path.join(projectDir, "src/use-hydrated.ts"), TRUE_SERVER_SNAPSHOT_HOOK);
    let incrementalReplayed: number | null = null;
    let incrementalConsidered: number | null = null;
    const incremental = await scanHydration(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        incrementalReplayed = replayedFileCount;
        incrementalConsidered = consideredFileCount;
      },
    });
    const full = await scanHydrationFull(projectDir);
    const hits = ruleHitsOn(incremental, HYDRATION_RULE_ID, "src/App.tsx");

    expect(serialize(incremental)).toBe(serialize(full));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      line: 4,
      column: 29,
      message:
        "`document` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot.",
    });
    expect(incrementalConsidered).toBeGreaterThan(0);
    expect(incrementalReplayed).toBeLessThan(incrementalConsidered);
  });

  it("invalidates an unchanged Next.js file when its owning package drops Next", async () => {
    const projectDir = setupNextDynamicApiFixture("next-owning-package-flip");
    const targetFilePath = "packages/app/app/page.tsx";
    const before = await scanNextDynamicApi(projectDir);
    let warmReplayed: number | null = null;
    let warmConsidered: number | null = null;
    await scanNextDynamicApi(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        warmReplayed = replayedFileCount;
        warmConsidered = consideredFileCount;
      },
    });
    expect(ruleHitsOn(before, NEXT_DYNAMIC_API_RULE_ID, targetFilePath)).toHaveLength(1);
    expect(warmConsidered).toBeGreaterThan(0);
    expect(warmReplayed).toBe(warmConsidered);

    writeFile(
      path.join(projectDir, "packages/app/package.json"),
      `{ "name": "app", "dependencies": { "react": "19.0.0", "vite": "15.0.0" } }\n`,
    );
    let incrementalReplayed: number | null = null;
    let incrementalConsidered: number | null = null;
    const incremental = await scanNextDynamicApi(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        incrementalReplayed = replayedFileCount;
        incrementalConsidered = consideredFileCount;
      },
    });
    const full = await scanNextDynamicApiFull(projectDir);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(ruleHitsOn(incremental, NEXT_DYNAMIC_API_RULE_ID, targetFilePath)).toEqual([]);
    expect(incrementalConsidered).toBeGreaterThan(0);
    expect(incrementalReplayed).toBeLessThan(incrementalConsidered);
  });

  it("keeps project-wide image ownership fresh when a consumer changes", async () => {
    const projectDir = setupNextImageFixture("next-image-consumer-flip");
    const targetFilePath = "lib/card.tsx";
    const before = await scanNextImage(projectDir);
    let warmReplayed: number | null = null;
    let warmConsidered: number | null = null;
    await scanNextImage(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        warmReplayed = replayedFileCount;
        warmConsidered = consideredFileCount;
      },
    });
    expect(ruleHitsOn(before, NEXT_NO_IMG_RULE_ID, targetFilePath)).toEqual([]);
    expect(warmConsidered).toBeNull();
    expect(warmReplayed).toBeNull();

    writeFile(
      path.join(projectDir, "app/api/card/route.tsx"),
      `import { Card } from "../../../lib/card";
export const Page = () => <Card />;
`,
    );
    let incrementalReplayed: number | null = null;
    let incrementalConsidered: number | null = null;
    const incremental = await scanNextImage(projectDir, {
      onSidecarStats: (replayedFileCount, consideredFileCount) => {
        incrementalReplayed = replayedFileCount;
        incrementalConsidered = consideredFileCount;
      },
    });
    const full = await scanNextImageFull(projectDir);
    const hits = ruleHitsOn(incremental, NEXT_NO_IMG_RULE_ID, targetFilePath);

    expect(serialize(incremental)).toBe(serialize(full));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      line: 1,
      column: 27,
      message: "Plain <img> ships unoptimized, oversized images.",
    });
    expect(incrementalConsidered).toBeNull();
    expect(incrementalReplayed).toBeNull();
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
