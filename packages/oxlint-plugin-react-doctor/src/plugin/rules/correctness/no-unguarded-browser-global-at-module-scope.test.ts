import { describe, expect, it } from "vite-plus/test";
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

  it("stays quiet in test/setup files", () => {
    const result = runRule(
      noUnguardedBrowserGlobalAtModuleScope,
      `const lang = navigator.language;`,
      { filename: "src/setupTests.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
