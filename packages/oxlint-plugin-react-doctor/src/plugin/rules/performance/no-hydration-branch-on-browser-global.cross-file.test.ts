import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hydration-browser-helper-"));
  __clearParseSourceFileCacheForTests();
  resetTsconfigAliasCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (source: string): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/AnimatedBackgroundImage.tsx", source);
  return runRule(noHydrationBranchOnBrowserGlobal, source, { filename: consumerPath });
};

describe("no-hydration-branch-on-browser-global — imported helper provenance", () => {
  it.each([
    ["a parameter cycle", "isReady(value)", 0],
    [
      "a parameter cycle with a browser predicate",
      'isReady(value) || typeof document !== "undefined"',
      1,
    ],
  ])("terminates %s across imported contexts", (_, returnedExpression, expectedCount) => {
    writeFile(
      "src/runtime.ts",
      `export const checkValue = (value) => ${returnedExpression}; const isReady = (value) => value === "ready";`,
    );
    const result = runConsumer(
      'import React from "react"; import { checkValue } from "./runtime"; export const Preview = ({ value }) => checkValue(value) ? <div /> : <section />;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it("resolves an aliased helper used in an unknown equality comparison", () => {
    writeFile("tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}');
    writeFile(
      "src/runtime.ts",
      'export function getMode() { return validateMode(typeof document === "undefined" ? "system" : localStorage.getItem("mode")); } function validateMode(mode) { return mode === "dark" || mode === "light" ? mode : "system"; }',
    );
    const result = runConsumer(
      'import React from "react"; import { getMode } from "@/runtime"; export const Preview = () => { const mode = getMode(); return mode === "dark" ? <div /> : <section />; };',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not attribute an unrelated exported browser predicate to a memoized helper", () => {
    writeFile(
      "src/runtime.ts",
      'export const readValue = ({ enabled }) => enabled; export function isBrowser() { return typeof document !== "undefined"; }',
    );
    const result = runConsumer(
      'import { useMemo } from "react"; import { readValue } from "./runtime"; export const Preview = ({ enabled }) => { const value = useMemo(() => { if (!enabled) return false; return readValue({ enabled }); }, [enabled]); return value && <div />; };',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["image on the server", "false"],
    ["video on the server", "true"],
  ])("reports a media capability branch with %s", (_, serverFallback) => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return ${serverFallback};
        return document.createElement("video").canPlayType(mime) !== "";
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an imported helper returns the same result on both runtimes", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return false;
        document.createElement("video").canPlayType(mime);
        return false;
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not attribute imported provenance to a shadowing local helper", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = () =>
        typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime as importedCapability } from "./video-background-mime";
      const canPlayVideoBackgroundMime = () => false;
      const AnimatedBackgroundImage = ({ src }) =>
        canPlayVideoBackgroundMime() ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an immutable argument statically disables the browser branch", () => {
    writeFile(
      "src/environment.ts",
      `export const isBrowser = (enabled) =>
        enabled && typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { isBrowser } from "./environment";
      const isEnabled = false;
      const AnimatedBackgroundImage = () =>
        isBrowser(isEnabled) ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a caller browser predicate passed through an imported helper", () => {
    writeFile("src/environment.ts", `export const identity = (value) => value;`);
    const result = runConsumer(`
      "use client";
      import { identity } from "./environment";
      const AnimatedBackgroundImage = () =>
        identity(typeof window !== "undefined") ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-hydration-branch-on-browser-global import resolution boundaries", () => {
  it.each([
    {
      name: "hydration-imported-helper-const-alias",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; const alias = isBrowser; export const View = () => alias() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 0,
    },
    {
      name: "hydration-imported-helper-direct-control",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-imported-helper-star-barrel",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export * from './helper';",
        "src/helper.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-imported-helper-named-barrel-control",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export { isBrowser } from './helper';",
        "src/helper.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-imported-helper-named-chain-3-files",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export { isBrowser } from './level-2';",
        "src/level-2.ts": "export { isBrowser } from './level-3';",
        "src/level-3.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-imported-helper-named-chain-4-files",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export { isBrowser } from './level-2';",
        "src/level-2.ts": "export { isBrowser } from './level-3';",
        "src/level-3.ts": "export { isBrowser } from './level-4';",
        "src/level-4.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-imported-helper-named-chain-5-files",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export { isBrowser } from './level-2';",
        "src/level-2.ts": "export { isBrowser } from './level-3';",
        "src/level-3.ts": "export { isBrowser } from './level-4';",
        "src/level-4.ts": "export { isBrowser } from './level-5';",
        "src/level-5.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 0,
    },
  ])("$name", ({ source, files, expectedCount }) => {
    for (const [filename, contents] of Object.entries(files)) {
      writeFile(filename, contents);
    }
    const result = runConsumer(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

describe("no-hydration-branch-on-browser-global star export resolution", () => {
  it.each([
    {
      name: "hydration-ambiguous-star-exports",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export * from './browser'; export * from './constant';",
        "src/browser.ts": "export const isBrowser = () => typeof window !== 'undefined';",
        "src/constant.ts": "export const isBrowser = () => false;",
      },
      expectedCount: 0,
    },
    {
      name: "hydration-same-origin-star-exports",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export * from './first'; export * from './second';",
        "src/first.ts": "export { isBrowser } from './browser';",
        "src/second.ts": "export { isBrowser } from './browser';",
        "src/browser.ts": "export const isBrowser = () => typeof window !== 'undefined';",
      },
      expectedCount: 1,
    },
    {
      name: "hydration-named-export-precedes-star",
      source:
        "import React from 'react'; import { isBrowser } from './entry'; export const View = () => isBrowser() ? <div /> : <span />;",
      files: {
        "src/entry.ts": "export * from './browser'; export { isBrowser } from './constant';",
        "src/browser.ts": "export const isBrowser = () => typeof window !== 'undefined';",
        "src/constant.ts": "export const isBrowser = () => false;",
      },
      expectedCount: 0,
    },
  ])("$name", ({ source, files, expectedCount }) => {
    for (const [filename, contents] of Object.entries(files)) {
      writeFile(filename, contents);
    }
    const result = runConsumer(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
