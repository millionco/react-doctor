import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalAtModuleScope } from "./no-unguarded-browser-global-at-module-scope.js";

const prod = { filename: "src/lib/foo.ts" };

describe("no-unguarded-browser-global-at-module-scope", () => {
  it("flags a module-scope window member read", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `export const cancelIdleCallback = window.cancelIdleCallback ?? clearTimeout;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a module-scope window feature detect in a ternary", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const observeResizes = window.ResizeObserver ? a : b;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a module-scope navigator read", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const lang = navigator.language;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a top-level localStorage.getItem call", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const stored = localStorage.getItem('k');`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare matchMedia call at module scope", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const mq = matchMedia('(min-width: 600px)');`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a nested member read only once", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const sw = navigator.serviceWorker.controller;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a read inside an arrow body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const tagClicked = () => window.alert('x');`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read inside a class field initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `class Widget { WINDOW_WIDTH = window.innerWidth; }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a typeof-guarded if block", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `let mode;
       if (typeof window !== 'undefined') { mode = window.foo; }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a typeof-guarded && expression", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const ok = typeof window !== 'undefined' && window.matchMedia;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare typeof operand", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const isBrowser = typeof window === 'undefined' ? false : true;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag globalThis member access", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const s = globalThis.localStorage;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag document reads (excluded from the global set)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const root = document.getElementById('root');`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a locally-shadowed window binding", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `import { window } from './mocks';
       const w = window.innerWidth;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read guarded by an aliased typeof check (fbjs/exenv canUseDOM idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const canUseDOM = typeof window !== 'undefined';
       const initialWidth = canUseDOM ? window.innerWidth : 0;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read guarded by a canUseDOM constant imported from a shared module", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `import { canUseDOM } from "@shared/utils/browser";
       const initialWidth = canUseDOM ? window.innerWidth : 0;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read guarded by an imported IS_BROWSER flag in an if block", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `import { IS_BROWSER } from "./env";
       if (IS_BROWSER) { window.addEventListener('resize', () => {}); }`,
      prod,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read guarded by an exported guard alias in an if block", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `export const isBrowser = typeof window !== 'undefined';
       if (isBrowser) { window.addEventListener('resize', () => {}); }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope read inside try/catch (localStorage feature-detect idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `let persisted = null;
       try { persisted = localStorage.getItem('theme'); } catch { persisted = null; }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a read when the catch rethrows the SSR failure", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `try { consume(window.innerWidth); } catch (error) { throw error; }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a read inside a try block without a catch handler", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `let persisted = null;
       try { persisted = localStorage.getItem('theme'); } finally { persisted = persisted ?? null; }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag window reads guarded by typeof document (DOM-library guard shape)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof document !== 'undefined') { window.addEventListener('resize', () => {}); }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads guarded by import.meta.env.SSR (Vite docs idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (!import.meta.env.SSR) { window.addEventListener('resize', () => {}); }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reads guarded by process.browser (legacy Next.js idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (process.browser) { window.addEventListener('resize', () => {}); }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in test/setup files", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const lang = navigator.language;`,
      { filename: "src/setupTests.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in Gatsby cache-dir client runtime files (browser-only webpack entries)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const loader = new ProdLoader(asyncRequires, matchPaths, window.pageData);
       window.asyncRequires = asyncRequires;
       window.addEventListener('unhandledrejection', () => {});`,
      { filename: "packages/gatsby/cache-dir/production-app.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in public assets that are served directly instead of imported during SSR", () => {
    const relativeResult = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `window.VditorI18n = { save: "Save" };`,
      { filename: "public/vditor/en_US.js" },
    );
    const monorepoResult = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `window.analyticsQueue = window.analyticsQueue || [];`,
      { filename: "/repo/apps/landing/public/static/analytics.js" },
    );
    expect(relativeResult.parseErrors).toEqual([]);
    expect(monorepoResult.parseErrors).toEqual([]);
    expect(relativeResult.diagnostics).toHaveLength(0);
    expect(monorepoResult.diagnostics).toHaveLength(0);
  });

  it("does not treat a public-prefixed source directory as a static public asset directory", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const language = navigator.language;`,
      { filename: "/repo/src/public-api/runtime.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unrelated cache-dir path as Gatsby browser runtime", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const language = navigator.language;`,
      { filename: "/repo/packages/app/cache-dir/runtime.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet in Remix .client. module files", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `export const agent = navigator.userAgent;`,
      { filename: "app/dashboard/index.client.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the module already throws under a typeof-window check (Gatsby loading-indicator idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof window === 'undefined') {
         throw new Error("Loading indicator should never be imported in code that doesn't target only browsers");
       }
       if (typeof window.___didShowBefore === 'undefined') {
         window.___didShowBefore = false;
       }
       const origin = window.location.origin;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["window", "const value = window.location.href;"],
    ["navigator", "const value = navigator.language;"],
    ["localStorage", 'const value = localStorage.getItem("theme");'],
    ["sessionStorage", 'const value = sessionStorage.getItem("theme");'],
    ["matchMedia", 'const value = matchMedia("(min-width: 1px)");'],
  ])("recognizes a terminating missing-%s guard before the same global", (globalName, read) => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof ${globalName} === "undefined") throw new Error("browser only");
       ${read}`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses a terminating window guard for browser globals covered by window availability", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof window === "undefined") throw new Error("window required");
       const language = navigator.language;
       const theme = localStorage.getItem("theme");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves terminating same-file browser aliases", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const canUseDOM = typeof window !== "undefined";
       if (!canUseDOM) throw new Error("browser only");
       const language = navigator.language;
       const theme = localStorage.getItem("theme");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not use a terminating storage guard to suppress another browser global", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof localStorage === "undefined") throw new Error("storage required");
       const language = navigator.language;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust the inverted terminating predicate", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof localStorage !== "undefined") throw new Error("storage disabled");
       const value = localStorage.getItem("theme");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a non-terminating missing-global branch", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof navigator === "undefined") log("server");
       const language = navigator.language;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not apply a terminating guard to an earlier read", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const value = sessionStorage.getItem("theme");
       if (typeof sessionStorage === "undefined") throw new Error("browser only");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a terminating guard on a shadowed browser-global binding", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const localStorage = undefined;
       if (typeof localStorage === "undefined") throw new Error("disabled");
       const language = navigator.language;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a compound missing guard whose false path may still lack a global", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof localStorage === "undefined" && typeof navigator === "undefined") {
         throw new Error("browser only");
       }
       const value = localStorage.getItem(navigator.language);`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust an AND guard whose false path may still lack the global", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof localStorage === "undefined" && shouldAbort) {
         throw new Error("disabled");
       }
       const value = localStorage.getItem("theme");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes an OR guard whose surviving path proves the global exists", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof localStorage === "undefined" || shouldAbort) {
         throw new Error("disabled");
       }
       const value = localStorage.getItem("theme");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a window-property assignment target because resolving window crashes SSR", () => {
    const result = runRule(noUnguardedBrowserGlobalAtModuleScope, `window.___emitter = emitter;`, {
      filename: "src/app.js",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a module-scope read next to a window-property assignment", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `window.___emitter = emitter;
       const publicLoader = window.___loader;`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a read that occurs before a terminating browser-only guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const width = window.innerWidth;
       if (typeof window === "undefined") throw new Error("browser only");`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags browser globals in static class initialization", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `class Viewport {
         static width = window.innerWidth;
         static { localStorage.getItem("theme"); }
       }`,
      prod,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a bare browser-global value read at module scope", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const browserWindow = window; consume(navigator);`,
      { filename: "/repo/src/runtime.ts" },
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags reads in the server-only side of an availability condition", () => {
    const ifResult = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof window === "undefined") { consume(window.location); }`,
      { filename: "/repo/src/runtime.ts" },
    );
    const logicalResult = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const broken = typeof window === "undefined" && navigator.language;`,
      { filename: "/repo/src/runtime.ts" },
    );
    expect(ifResult.diagnostics).toHaveLength(1);
    expect(logicalResult.diagnostics).toHaveLength(1);
  });

  it("does not mistake a browser-only terminating branch for an SSR guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (typeof window !== "undefined") { throw new Error("browser disabled"); }
       const language = navigator.language;`,
      { filename: "/repo/src/runtime.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unrelated terminating branch as a browser-only module guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `if (shouldAbort) throw new Error("disabled");
       const width = window.innerWidth;`,
      { filename: "/repo/src/runtime.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat client as a browser-only suffix when it is not next to the extension", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const width = window.innerWidth;`,
      { filename: "/repo/src/dashboard.client.shared.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a guard-named local binding with a shadowed browser global", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const window = {};
       const canUseDOM = typeof window !== "undefined";
       const userAgent = canUseDOM ? navigator.userAgent : "";`,
      { filename: "/project/src/browser-state.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a guard-named local binding with a shadowed process", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const process = { browser: true };
       const canUseDOM = process.browser;
       const userAgent = canUseDOM ? navigator.userAgent : "";`,
      { filename: "/project/src/browser-state.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  describe("cross-file imported guards", () => {
    let temporaryDirectory = "";

    beforeEach(() => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-browser-global-module-"));
    });

    afterEach(() => {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    const createProjectFile = (relativePath: string, contents: string): string => {
      const absolutePath = path.join(temporaryDirectory, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
      return absolutePath;
    };

    const moduleFilename = (): string => path.join(temporaryDirectory, "src", "widths.ts");

    const guardedByImportedConst = `import { canUseDOM } from "./env";
      export const initialWidth = canUseDOM ? window.innerWidth : 0;`;

    it("stays quiet behind an imported canUseDOM const whose foreign initializer is a typeof-window check", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = typeof window !== "undefined";\n`);
      const result = runRule(noUnguardedBrowserGlobalAtModuleScope, guardedByImportedConst, {
        filename: moduleFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("stays quiet behind an imported off-list guard name once its typeof-window initializer resolves", () => {
      createProjectFile(
        "src/env.ts",
        `export const browserReady = typeof window !== "undefined";\n`,
      );
      const result = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { browserReady } from "./env";
         const initialWidth = browserReady ? window.innerWidth : 0;`,
        { filename: moduleFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags when the imported canUseDOM resolves to a non-typeof initializer (name alone no longer vouches)", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = true;\n`);
      const result = runRule(noUnguardedBrowserGlobalAtModuleScope, guardedByImportedConst, {
        filename: moduleFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays quiet behind an imported guard function whose body returns a typeof-window check", () => {
      createProjectFile(
        "src/env.ts",
        `export const canUseDOM = () => typeof window !== "undefined";\n`,
      );
      const result = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { canUseDOM } from "./env";
         if (canUseDOM()) { window.addEventListener('resize', () => {}); }`,
        { filename: moduleFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not trust a foreign typeof check against a shadowed window binding", () => {
      createProjectFile(
        "src/env.ts",
        `const window = {};
         export const canUseDOM = typeof window !== "undefined";\n`,
      );
      const result = runRule(noUnguardedBrowserGlobalAtModuleScope, guardedByImportedConst, {
        filename: moduleFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not trust a foreign typeof check against an imported window binding", () => {
      createProjectFile(
        "src/env.ts",
        `import window from "./window-shim";
         export const canUseDOM = typeof window !== "undefined";\n`,
      );
      const result = runRule(noUnguardedBrowserGlobalAtModuleScope, guardedByImportedConst, {
        filename: moduleFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not trust a foreign guard function whose parameter shadows window", () => {
      createProjectFile(
        "src/env.ts",
        `export const canUseDOM = (window = {}) => typeof window !== "undefined";\n`,
      );
      const result = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { canUseDOM } from "./env";
         if (canUseDOM()) consume(window.innerWidth);`,
        { filename: moduleFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("preserves the polarity of an imported server guard", () => {
      createProjectFile("src/env.ts", `export const isServer = typeof window === "undefined";\n`);
      const browserBranch = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { isServer } from "./env";
         if (!isServer) consume(window.innerWidth);`,
        { filename: moduleFilename() },
      );
      const serverBranch = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { isServer } from "./env";
         if (isServer) consume(window.innerWidth);`,
        { filename: moduleFilename() },
      );
      expect(browserBranch.parseErrors).toEqual([]);
      expect(serverBranch.parseErrors).toEqual([]);
      expect(browserBranch.diagnostics).toHaveLength(0);
      expect(serverBranch.diagnostics).toHaveLength(1);
    });

    it("keeps the guard-name fallback when the import does not resolve", () => {
      const result = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { canUseDOM } from "./missing-env";
         const initialWidth = canUseDOM ? window.innerWidth : 0;`,
        { filename: moduleFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags an unresolvable imported non-guard flag (unresolved never becomes a guard)", () => {
      const result = runRule(
        noUnguardedBrowserGlobalAtModuleScope,
        `import { IS_CLICKHOUSE_BUILD } from "./missing-env";
         const initialWidth = IS_CLICKHOUSE_BUILD ? window.innerWidth : 0;`,
        { filename: moduleFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("keeps the guard-name fallback when the host provides no filename", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = true;\n`);
      const result = runRule(noUnguardedBrowserGlobalAtModuleScope, guardedByImportedConst, {
        filename: undefined,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  it("does not report runtime-looking statements in declaration files", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `window.PdfViewer = window.PdfViewer || {};`,
      { filename: "src/types/pdfjs.d.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
