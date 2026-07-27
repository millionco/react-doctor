import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";

const RULE_ID = "no-unguarded-browser-global-at-module-scope";
const WINDOW_DIAGNOSTIC_MESSAGE =
  'Reading `window` here crashes with "ReferenceError: window is not defined" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with `typeof window !== "undefined"`.';
const NAVIGATOR_DIAGNOSTIC_MESSAGE =
  'Reading `navigator` here crashes with "ReferenceError: navigator is not defined" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with `typeof navigator !== "undefined"`.';
const LOCAL_STORAGE_DIAGNOSTIC_MESSAGE =
  'Reading `localStorage` here crashes with "ReferenceError: localStorage is not defined" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with `typeof localStorage !== "undefined"`.';

const PROJECT_FILES = new Map<string, string>([
  [
    "src/environment.ts",
    `export const browserReady = typeof window !== "undefined";
export const isServer = typeof window === "undefined";
export const browserReadyFunction = () => typeof window !== "undefined";
export const configuredBrowser = true;`,
  ],
  [
    "src/guards/index.ts",
    `export {
  browserReady,
  browserReadyFunction,
  configuredBrowser,
  isServer,
} from "../environment";`,
  ],
  [
    "src/guarded.ts",
    `import { browserReady } from "./guards";

export const initialWidth = browserReady ? window.innerWidth : 0;`,
  ],
  [
    "src/false-guard.ts",
    `import { configuredBrowser as canUseDOM } from "./guards";

export const initialWidth = canUseDOM ? window.innerWidth : 0;`,
  ],
  [
    "src/server-branch.ts",
    `import { isServer } from "./guards";

if (isServer) consume(window.innerWidth);`,
  ],
  [
    "src/browser-branch.ts",
    `import { isServer } from "./guards";

if (!isServer) consume(window.innerWidth);`,
  ],
  [
    "src/function-guard.ts",
    `import { browserReadyFunction } from "./guards";

if (browserReadyFunction()) consume(window.innerWidth);`,
  ],
  [
    "src/missing-flag.ts",
    `import { IS_SPECIAL_BUILD } from "./missing-environment";

export const language = IS_SPECIAL_BUILD ? navigator.language : "";`,
  ],
  [
    "src/direct-read.ts",
    `"🛰️";\r
export const savedTheme = localStorage.getItem("theme");`,
  ],
  ["src/invalid.ts", "export const ="],
]);

const temporaryDirectories: string[] = [];

describe("browser guard project evaluation", () => {
  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps imported guard polarity exactly aligned", () => {
    const temporaryRootDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "react-doctor-evaluate-browser-guard-"),
    );
    temporaryDirectories.push(temporaryRootDirectory);
    for (const [filename, sourceText] of PROJECT_FILES) {
      const absoluteFilename = path.join(temporaryRootDirectory, filename);
      fs.mkdirSync(path.dirname(absoluteFilename), { recursive: true });
      fs.writeFileSync(absoluteFilename, sourceText, "utf8");
    }

    const realResult = evaluateProject({
      files: PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: temporaryRootDirectory,
      }),
      ruleIds: [RULE_ID],
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-browser-guard-project",
      files: PROJECT_FILES,
      ruleIds: [RULE_ID],
    });

    expect(virtualResult).toEqual(realResult);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, rule, message, line, column, offset, length, endLine, endColumn }) => ({
          filePath,
          rule,
          message,
          line,
          column,
          offset,
          length,
          endLine,
          endColumn,
        }),
      ),
    ).toEqual([
      {
        filePath: "src/false-guard.ts",
        rule: RULE_ID,
        message: WINDOW_DIAGNOSTIC_MESSAGE,
        line: 3,
        column: 41,
        offset: 100,
        length: 6,
        endLine: 3,
        endColumn: 47,
      },
      {
        filePath: "src/server-branch.ts",
        rule: RULE_ID,
        message: WINDOW_DIAGNOSTIC_MESSAGE,
        line: 3,
        column: 23,
        offset: 60,
        length: 6,
        endLine: 3,
        endColumn: 29,
      },
      {
        filePath: "src/missing-flag.ts",
        rule: RULE_ID,
        message: NAVIGATOR_DIAGNOSTIC_MESSAGE,
        line: 3,
        column: 44,
        offset: 102,
        length: 9,
        endLine: 3,
        endColumn: 53,
      },
      {
        filePath: "src/direct-read.ts",
        rule: RULE_ID,
        message: LOCAL_STORAGE_DIAGNOSTIC_MESSAGE,
        line: 2,
        column: 27,
        offset: 38,
        length: 12,
        endLine: 2,
        endColumn: 39,
      },
    ]);
    expect(virtualResult.failures).toEqual([
      {
        kind: "parse",
        filePath: "src/invalid.ts",
        message: "Unexpected token",
        line: 1,
        column: 14,
        offset: 13,
        length: 1,
      },
    ]);
    expect(
      virtualResult.diagnostics.filter((diagnostic) =>
        ["src/guarded.ts", "src/browser-branch.ts", "src/function-guard.ts"].includes(
          diagnostic.filePath,
        ),
      ),
    ).toEqual([]);
  });

  it("keeps source-only evaluation explicitly unsupported", () => {
    expect(
      evaluateSource({
        sourceText: `export const width = window.innerWidth;`,
        filename: "src/component.ts",
        ruleIds: [RULE_ID],
      }),
    ).toEqual({
      diagnostics: [],
      failures: [
        {
          kind: "unsupported-rule",
          filePath: "src/component.ts",
          rule: RULE_ID,
          message: `Rule requires a project host: ${RULE_ID}`,
        },
      ],
    });
  });
});
