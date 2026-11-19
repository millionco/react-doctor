import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("exhaustive-deps with a Boolean memo dependency", () => {
  it("keeps the complex warning when the memo only tests the callback's presence", () => {
    const result = runRule(
      exhaustiveDeps,
      `
      import { useEffect, useMemo, useRef } from 'react';
      export function useSearch({ onSearch }) {
        const latestSearch = useRef(onSearch);
        useEffect(() => { latestSearch.current = onSearch; }, [onSearch]);
        return useMemo(
          () => onSearch ? (query) => latestSearch.current?.(query) : undefined,
          [onSearch ? true : false],
        );
      }
      `,
      { filename: "fixture.tsx" },
    );
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      expect.stringContaining("A complex expression"),
    ]);
  });

  it.each([
    ["invokes the raw callback", "onSearch ? (query) => onSearch(query) : undefined"],
    ["returns the raw callback", "onSearch ? onSearch : undefined"],
    ["tests a nullish fallback", "(onSearch ?? true) ? 1 : 0"],
    ["returns an operand with short-circuit evaluation", "onSearch && 1"],
  ])("keeps both warnings when the memo %s", (_description, body) => {
    const result = runRule(
      exhaustiveDeps,
      `
      import { useMemo } from 'react';
      export function useSearch({ onSearch }) {
        return useMemo(() => ${body}, [onSearch ? true : false]);
      }
      `,
      { filename: "fixture.tsx" },
    );
    const messages = result.diagnostics.map(({ message }) => message);
    expect(messages).toHaveLength(2);
    expect(messages).toContainEqual(expect.stringContaining("A complex expression"));
    expect(messages).toContainEqual(expect.stringContaining("with a stale `onSearch`"));
  });

  it("keeps the missing capture when a direct eval can read the raw value", () => {
    const result = runRule(
      exhaustiveDeps,
      `
      import { useMemo } from 'react';
      export function useSearch({ onSearch }) {
        return useMemo(
          () => onSearch ? eval('onSearch') : undefined,
          [onSearch ? true : false],
        );
      }
      `,
      { filename: "fixture.tsx" },
    );
    expect(result.diagnostics.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("with a stale `onSearch`"),
    );
  });

  it("keeps the missing capture for a replaced React export object", () => {
    const result = runRule(
      exhaustiveDeps,
      `
      import React, { useMemo } from 'react';
      const stockMemo = React.useMemo;
      Object.defineProperty(React, 'useMemo', {
        value: (create, deps) => stockMemo(create, deps.some(dep => typeof dep === 'boolean') ? [] : deps),
      });
      export function useSearch({ onSearch }) {
        return useMemo(() => onSearch ? 1 : 0, [onSearch ? true : false]);
      }
      `,
      { filename: "fixture.tsx" },
    );
    expect(result.diagnostics.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("with a stale `onSearch`"),
    );
  });

  it.each(["const React = require('react');", "import React = require('react');"])(
    "keeps the missing capture when CommonJS exposes React through %s",
    (loadReact) => {
      const result = runRule(
        exhaustiveDeps,
        `
      import { useMemo } from 'react';
      ${loadReact}
      const stockMemo = React.useMemo;
      Object.defineProperty(React, 'useMemo', {
        value: (create, deps) => stockMemo(create, deps.some(dep => typeof dep === 'boolean') ? [] : deps),
      });
      export function useSearch({ onSearch }) {
        return useMemo(() => onSearch ? 1 : 0, [onSearch ? true : false]);
      }
      `,
        { filename: "fixture.tsx" },
      );
      expect(result.diagnostics.map(({ message }) => message)).toContainEqual(
        expect.stringContaining("with a stale `onSearch`"),
      );
    },
  );
});
