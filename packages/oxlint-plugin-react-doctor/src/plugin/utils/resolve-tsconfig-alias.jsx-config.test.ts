import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS,
  TSCONFIG_EXTENDS_MAX_DEPTH,
} from "../constants/thresholds.js";
import { captureCrossFileProbes } from "./cross-file-probe-recorder.js";
import {
  hasStandardReactJsxConfiguration,
  resetTsconfigAliasCaches,
  resolveTsconfigAliasPath,
} from "./resolve-tsconfig-alias.js";

interface JsxConfigurationCase {
  readonly name: string;
  readonly config: string;
  readonly eligible: boolean;
}

let temporaryDirectory: string;
const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return absolutePath;
};
const fromFile = (): string => path.join(temporaryDirectory, "src/panel.tsx");
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-jsx-config-"));
  resetTsconfigAliasCaches();
});
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});
const cases: ReadonlyArray<JsxConfigurationCase> = [
  { name: "default React role", config: "{}", eligible: true },
  { name: "React classic", config: '{"compilerOptions":{"jsx":"react"}}', eligible: true },
  { name: "React automatic", config: '{"compilerOptions":{"jsx":"react-jsx"}}', eligible: true },
  {
    name: "React development",
    config: '{"compilerOptions":{"jsx":"react-jsxdev"}}',
    eligible: true,
  },
  {
    name: "preserved JSX ordinary React role",
    config: '{"compilerOptions":{"jsx":"preserve"}}',
    eligible: true,
  },
  {
    name: "explicit React import source",
    config: '{"compilerOptions":{"jsxImportSource":"react"}}',
    eligible: true,
  },
  {
    name: "custom JSX factory",
    config: '{"compilerOptions":{"jsxFactory":"publishJsx"}}',
    eligible: false,
  },
  {
    name: "explicit classic factory remains outside V1",
    config: '{"compilerOptions":{"jsxFactory":"React.createElement"}}',
    eligible: false,
  },
  {
    name: "custom fragment factory",
    config: '{"compilerOptions":{"jsxFragmentFactory":"publishFragment"}}',
    eligible: false,
  },
  {
    name: "custom import source",
    config: '{"compilerOptions":{"jsxImportSource":"other-runtime"}}',
    eligible: false,
  },
  {
    name: "null import source",
    config: '{"compilerOptions":{"jsxImportSource":null}}',
    eligible: false,
  },
  {
    name: "unknown JSX mode",
    config: '{"compilerOptions":{"jsx":"react-native"}}',
    eligible: false,
  },
  { name: "invalid JSX value", config: '{"compilerOptions":{"jsx":true}}', eligible: false },
  { name: "invalid compiler options", config: '{"compilerOptions":null}', eligible: false },
  { name: "array compiler options", config: '{"compilerOptions":[]}', eligible: false },
  { name: "invalid top-level array", config: "[]", eligible: false },
  { name: "invalid JSON", config: '{"compilerOptions":', eligible: false },
  { name: "unterminated JSONC block comment", config: "{} /* unfinished", eligible: false },
  { name: "array extends", config: '{"extends":[]}', eligible: false },
  { name: "object extends", config: '{"extends":{}}', eligible: false },
  { name: "null extends", config: '{"extends":null}', eligible: false },
  { name: "empty extends", config: '{"extends":""}', eligible: false },
  { name: "missing extends", config: '{"extends":"./missing"}', eligible: false },
];

describe("hasStandardReactJsxConfiguration", () => {
  it.each(cases)("$name", ({ config, eligible }) => {
    writeFile("tsconfig.json", config);
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(eligible);
  });

  it("reuses JSONC comments and trailing-comma parsing", () => {
    writeFile(
      "tsconfig.json",
      `{
      // ordinary project options
      "compilerOptions": { "jsx": "react-jsx", },
    }`,
    );
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
  });

  it("stops at a nearest JSX-only config instead of searching for aliases", () => {
    writeFile("tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{}}}');
    const nearest = writeFile(
      "src/jsconfig.json",
      '{"compilerOptions":{"jsxFactory":"publishJsx"}}',
    );
    const captured = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
    expect(captured.value).toBe(false);
    expect(captured.trace.contentPaths).toContain(nearest);
    expect(captured.trace.contentPaths).not.toContain(
      path.join(temporaryDirectory, "tsconfig.json"),
    );
  });

  it("uses the nearest actual standard config instead of an outer custom config", () => {
    writeFile("tsconfig.json", '{"compilerOptions":{"jsxFactory":"outerPublisher"}}');
    writeFile("src/jsconfig.json", '{"compilerOptions":{"jsx":"react-jsx"}}');
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
  });

  it("declines an invalid nearest config instead of falling through to jsconfig or parent", () => {
    writeFile("tsconfig.json", "{}");
    writeFile("src/tsconfig.json", "{");
    writeFile("src/jsconfig.json", "{}");
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it("declines a directory at the config path", () => {
    fs.mkdirSync(path.join(temporaryDirectory, "tsconfig.json"));
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it("normalizes relative filenames before walking to a filesystem root", () => {
    writeFile("tsconfig.json", '{"compilerOptions":{"jsxFactory":"publishJsx"}}');
    const filename = path.relative(process.cwd(), fromFile());
    expect(hasStandardReactJsxConfiguration(filename)).toBe(false);
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it("follows relative and bare explicit config inheritance", () => {
    writeFile("tsconfig.json", '{"extends":"./base"}');
    writeFile("base.json", '{"extends":"@fixture/react/tsconfig.json"}');
    const inherited = writeFile(
      "node_modules/@fixture/react/tsconfig.json",
      '{"compilerOptions":{"jsx":"react-jsx"}}',
    );
    const captured = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
    expect(captured.value).toBe(true);
    expect(captured.trace.contentPaths).toContain(inherited);
  });

  it("declines inherited custom JSX even if the leaf selects a standard mode", () => {
    writeFile("tsconfig.json", '{"extends":"./base","compilerOptions":{"jsx":"react-jsx"}}');
    writeFile("base.json", '{"compilerOptions":{"jsxFactory":"publishJsx"}}');
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it("declines absolute inheritance outside the selected relative/bare resolver scope", () => {
    const inherited = writeFile("base.json", "{}");
    writeFile("tsconfig.json", JSON.stringify({ extends: inherited }));
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it.each(["}", "]"])(
    "declines a valid string comma sequence before %s without reading a rewritten parent",
    (closer) => {
      const selectedParent = `base, ${closer}.json`;
      const rewrittenParent = `base ${closer}.json`;
      writeFile("tsconfig.json", JSON.stringify({ extends: `./${selectedParent}` }));
      writeFile(selectedParent, '{"compilerOptions":{"jsxFactory":"publishJsx"}}');
      const wrongParentPath = writeFile(rewrittenParent, "{}");
      const captured = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
      expect(captured.value).toBe(false);
      expect(captured.trace.contentPaths).not.toContain(wrongParentPath);
    },
  );

  it("declines an inheritance cycle", () => {
    writeFile("tsconfig.json", '{"extends":"./base"}');
    writeFile("base.json", '{"extends":"./tsconfig"}');
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });

  it("distinguishes completed inheritance from depth exhaustion", () => {
    writeFile("tsconfig.json", '{"extends":"./chain-0"}');
    for (let index = 0; index < TSCONFIG_EXTENDS_MAX_DEPTH; index++) {
      writeFile(`chain-${index}.json`, JSON.stringify({ extends: `./chain-${index + 1}` }));
    }
    writeFile(`chain-${TSCONFIG_EXTENDS_MAX_DEPTH}.json`, "{}");
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
    writeFile(`chain-${TSCONFIG_EXTENDS_MAX_DEPTH - 1}.json`, "{}");
    resetTsconfigAliasCaches();
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
  });

  it("declines an incomplete upward walk even when another directory memo is warm", () => {
    writeFile("tsconfig.json", "{}");
    const segments = Array.from(
      { length: CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS - 1 },
      (_, index) => `level-${index}`,
    );
    expect(
      hasStandardReactJsxConfiguration(path.join(temporaryDirectory, ...segments, "panel.tsx")),
    ).toBe(true);
    expect(
      hasStandardReactJsxConfiguration(
        path.join(temporaryDirectory, ...segments, "deeper", "panel.tsx"),
      ),
    ).toBe(false);
  });

  it("allows absence only after reaching the filesystem root", () => {
    vi.spyOn(fs, "lstatSync").mockReturnValue(undefined);
    syncBuiltinESMExports();
    const sourcePath = path.join(path.parse(temporaryDirectory).root, "missing", "panel.tsx");
    const captured = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(sourcePath));
    expect(captured.value).toBe(true);
    expect(captured.trace.existencePaths).toContain(
      path.join(path.parse(sourcePath).root, "tsconfig.json"),
    );
    expect(captured.trace.existencePaths).toContain(
      path.join(path.parse(sourcePath).root, "jsconfig.json"),
    );
  });

  it("replays inherited and negative probes from a scan memo", () => {
    const configPath = writeFile("tsconfig.json", '{"extends":"./base"}');
    const inheritedPath = writeFile("base.json", '{"compilerOptions":{"jsx":"react-jsx"}}');
    const first = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
    const second = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
    expect(first.value).toBe(true);
    expect(second.value).toBe(true);
    expect(second.trace).toEqual(first.trace);
    expect(second.trace.contentPaths).toContain(configPath);
    expect(second.trace.contentPaths).toContain(inheritedPath);
    expect(second.trace.existencePaths).toContain(
      path.join(temporaryDirectory, "src/tsconfig.json"),
    );
  });

  it("invalidates the scan memo with equal-size restored-mtime inherited edits", () => {
    writeFile("tsconfig.json", '{"extends":"./base"}');
    const initial = '{"compilerOptions":{"jsxImportSource":"react"}}';
    const changed = initial.replace("react", "other");
    const inheritedPath = writeFile("base.json", initial);
    const originalStat = fs.statSync(inheritedPath);
    expect(changed.length).toBe(initial.length);
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
    fs.writeFileSync(inheritedPath, changed);
    fs.utimesSync(inheritedPath, originalStat.atime, originalStat.mtime);
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
    resetTsconfigAliasCaches();
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
    fs.writeFileSync(inheritedPath, initial);
    fs.utimesSync(inheritedPath, originalStat.atime, originalStat.mtime);
    resetTsconfigAliasCaches();
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
  });

  it("observes missing inherited config appearance after reset", () => {
    writeFile("tsconfig.json", '{"extends":"./later"}');
    const first = captureCrossFileProbes(() => hasStandardReactJsxConfiguration(fromFile()));
    const target = path.join(temporaryDirectory, "later.json");
    expect(first.value).toBe(false);
    expect(first.trace.contentPaths).toContain(target);
    writeFile("later.json", "{}");
    resetTsconfigAliasCaches();
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(true);
  });

  it("keeps alias-bearing lookup separate from nearest actual JSX config", () => {
    writeFile(
      "tsconfig.json",
      '{"compilerOptions":{"baseUrl":".","paths":{"@item":["src/item.ts"]}}}',
    );
    writeFile("src/jsconfig.json", '{"compilerOptions":{"jsxFactory":"publishJsx"}}');
    const target = writeFile("src/item.ts", "export const value = 1;");
    expect(resolveTsconfigAliasPath(fromFile(), "@item")).toBe(target);
    expect(hasStandardReactJsxConfiguration(fromFile())).toBe(false);
  });
});
