import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImpureCallAtModuleScope } from "./no-impure-call-at-module-scope.js";

describe("no-impure-call-at-module-scope", () => {
  it("flags Math.random() sampling at module scope (retailer-visitor shape)", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const SHOULD_TRACK = Math.random() * 100 < SAMPLE_RATE;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("Math.random()");
  });

  it("flags new Date().getTimezoneOffset() date math at module scope", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `const USER_TIMEZONE_OFFSET_IN_MILLIS = new Date().getTimezoneOffset() * 60000;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Date()");
  });

  it("flags a bare new Date() constant at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const CURRENT_TIMESTAMP = new Date();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Date.now() at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const RENDERED = Date.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags performance.now() at module scope", () => {
    const result = runRule(noImpureCallAtModuleScope, `const MARK = performance.now();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static class-field initializer", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      class Sampler {
        static sample = Math.random();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an exported module-scope constant", () => {
    const result = runRule(noImpureCallAtModuleScope, `export const RATE = Math.random();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the same call inside a function body", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      function sample() {
        const value = Math.random();
        return value;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same call inside a component", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      const Clock = () => {
        const now = Date.now();
        return null;
      };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lazy getter arrow", () => {
    const result = runRule(noImpureCallAtModuleScope, `const getNow = () => Date.now();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date(timestamp) with an argument", () => {
    const result = runRule(noImpureCallAtModuleScope, `const AT = new Date(1700000000000);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag crypto.randomUUID() (dropped per revision)", () => {
    const result = runRule(noImpureCallAtModuleScope, `const INSTANCE = crypto.randomUUID();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-static (instance) class field", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      class Sampler {
        sample = Math.random();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a per-process-named binding (uptime/instance id)", () => {
    const result = runRule(noImpureCallAtModuleScope, `const bootTime = Date.now();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag camelCase per-process uptime names (startTime/appBootTime/serverStartedAt)", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `const startTime = Date.now();`).diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(noImpureCallAtModuleScope, `const appBootTime = Date.now();`).diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(noImpureCallAtModuleScope, `const serverStartedAt = Date.now();`).diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(noImpureCallAtModuleScope, `const SERVER_START_TIME = Date.now();`).diagnostics,
    ).toHaveLength(0);
  });

  it("does not flag a jotai atom seeded with Date.now() (TaskTrove refresh-trigger shape)", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      import { atom } from "jotai";
      export const appRefreshTriggerAtom = atom<number>(Date.now());
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag state-container factory seeds (svelte writable, rxjs BehaviorSubject)", () => {
    expect(
      runRule(noImpureCallAtModuleScope, `export const lastUpdated = writable(Date.now());`)
        .diagnostics,
    ).toHaveLength(0);
    expect(
      runRule(noImpureCallAtModuleScope, `const clock$ = new BehaviorSubject(Date.now());`)
        .diagnostics,
    ).toHaveLength(0);
  });

  it("does not flag a static field of a class created inside a factory/mixin", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `export const withInstanceKey = (Base) => class extends Base { static key = Math.random().toString(36); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when Date is shadowed by a local binding", () => {
    const result = runRule(
      noImpureCallAtModuleScope,
      `
      const Date = FakeDate;
      const NOW = new Date();
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inside test/story files (test-noise)", () => {
    const result = runRule(noImpureCallAtModuleScope, `const NOW = Date.now();`, {
      filename: "src/widget.stories.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
