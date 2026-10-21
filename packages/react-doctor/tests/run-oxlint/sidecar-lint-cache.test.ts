import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { buildDiagnosticIdentity, runOxlint } from "@react-doctor/core";
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
