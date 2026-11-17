import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { octaneNoHookInLoop } from "./octane-no-hook-in-loop.js";

const runOctaneRule = (source: string) =>
  runRule(octaneNoHookInLoop, source, { filename: "app.tsx" });

describe("octane-no-hook-in-loop", () => {
  it("reports built-in hooks in every plain JavaScript loop form", () => {
    const result = runOctaneRule(`
      import { useId, useMemo, useRef, useState } from "octane";
      export const Example = ({ count, records }) => {
        for (let index = 0; index < count; index++) useMemo(() => index);
        for (const key in records) useId();
        for (const value of records) useState(value);
        while (records.length > 0) useRef(null);
        do useState(0); while (false);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(5);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("`for` iteration"),
        expect.stringContaining("`for…in` iteration"),
        expect.stringContaining("`for…of` iteration"),
        expect.stringContaining("`while` iteration"),
        expect.stringContaining("`do…while` iteration"),
      ]),
    );
  });

  it("resolves Octane hook aliases and namespace members", () => {
    const result = runOctaneRule(`
      import * as Octane from "octane";
      import { useState as state } from "octane";
      export const Example = ({ values }) => {
        for (const value of values) {
          state(value);
          Octane.useReducer((current) => current, value);
        }
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("`useState`");
    expect(result.diagnostics[1]?.message).toContain("`useReducer`");
  });

  it("reports custom identifier and method hooks in an Octane module", () => {
    const result = runOctaneRule(`
      import { Fragment } from "octane";
      export const Example = ({ routes }) => {
        for (const route of routes) {
          useRoute(route);
          route.useMatch();
        }
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("`useRoute`");
    expect(result.diagnostics[1]?.message).toContain("`useMatch`");
  });

  it("follows IIFEs and synchronous callbacks executing inside a loop", () => {
    const result = runOctaneRule(`
      import { useMemo, useRef } from "octane";
      export const Example = ({ groups }) => {
        for (const group of groups) {
          (() => useMemo(() => group))();
          (function () { useRef(null); }).call(null);
          group.items.map(() => useRow());
        }
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows deferred nested functions and loop-free iterator callbacks", () => {
    const result = runOctaneRule(`
      import { useState } from "octane";
      export const Example = ({ values }) => {
        const rows = values.map((value) => useRow(value));
        for (const value of values) {
          rows.push(() => useState(value));
        }
        return rows;
      };
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows use and useContext inside loops", () => {
    const result = runOctaneRule(`
      import { use, useContext } from "octane";
      export const Example = ({ Context, promises }) => {
        for (const promise of promises) {
          use(promise);
          useContext(Context);
        }
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows Octane hooks behind conditions and early returns", () => {
    const result = runOctaneRule(`
      import { useState } from "octane";
      export const Example = ({ enabled }) => {
        if (!enabled) return null;
        if (enabled) useState(0);
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply Octane semantics to foreign or type-only modules", () => {
    const reactResult = runOctaneRule(`
      import { useState } from "react";
      export const Example = ({ values }) => {
        for (const value of values) useState(value);
        return null;
      };
    `);
    const typeOnlyResult = runOctaneRule(`
      import type { Component } from "octane";
      export const Example = ({ values }) => {
        for (const value of values) useLocalState(value);
        return null;
      };
    `);

    expect(reactResult.diagnostics).toHaveLength(0);
    expect(typeOnlyResult.diagnostics).toHaveLength(0);
  });

  it("recognizes the Octane JSX import-source pragma", () => {
    const result = runOctaneRule(`
      /** @jsxImportSource octane */
      export const Example = ({ values }) => {
        for (const value of values) useRow(value);
        return null;
      };
    `);

    expect(result.diagnostics).toHaveLength(1);
  });
});
