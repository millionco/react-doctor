import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

describe("no-hydration-branch-on-browser-global native parity regressions", () => {
  it.each([
    [
      "side-effect React import is client render evidence",
      'import "react"; export const Preview = () => typeof document === "undefined" ? <div /> : <section />;',
      1,
    ],
    [
      "missing React evidence remains suppressed",
      'export const Preview = () => typeof document === "undefined" ? <div /> : <section />;',
      0,
    ],
    [
      "self recursion",
      '"use client"; const recurse = () => recurse(); export const Preview = () => recurse() ? <div /> : <span />;',
      0,
    ],
    [
      "mutual recursion",
      '"use client"; const first = () => second(); const second = () => first(); export const Preview = () => first() ? <div /> : <span />;',
      0,
    ],
    [
      "parameter recursion",
      '"use client"; const recurse = (value) => recurse(value); export const Preview = () => recurse(true) ? <div /> : <span />;',
      0,
    ],
    [
      "independent predicate after recursion",
      '"use client"; const recurse = () => recurse() || typeof window !== "undefined"; export const Preview = () => recurse() ? <div /> : <span />;',
      1,
    ],
    [
      "known strict equality",
      '"use client"; export const Preview = () => (typeof window !== "undefined") === true ? <div /> : <section />;',
      1,
    ],
    [
      "invariant strict equality",
      '"use client"; export const Preview = () => (typeof window !== "undefined") === 42 ? <div /> : <section />;',
      0,
    ],
    [
      "loose equality",
      '"use client"; export const Preview = () => (typeof window !== "undefined") == 1 ? <div /> : <section />;',
      1,
    ],
    [
      "reflexive runtime alias",
      '"use client"; export const Preview = () => { const runtime = typeof window === "undefined" ? "server" : "client"; return runtime === runtime ? <div /> : <section />; };',
      0,
    ],
    [
      "unknown helper equality",
      '"use client"; const getMode = () => typeof document === "undefined" ? "system" : localStorage.getItem("mode"); export const Preview = () => { const mode = getMode(); return mode === "dark" ? <div /> : <section />; };',
      1,
    ],
    [
      "function body following return",
      'import React from "react"; export function Preview() { if (typeof window === "undefined") return <div />; return <section />; }',
      1,
    ],
    [
      "wrapper versus children",
      'import React from "react"; export const Preview = (props) => { if (typeof window !== "undefined") return <section>{props.children}</section>; return props.children; };',
      1,
    ],
    [
      "fragment versus provider",
      'import React from "react"; export function Preview({ children }) { if (typeof window !== "undefined") return <>{children}</>; return <Provider>{children}</Provider>; }',
      1,
    ],
    [
      "equivalent following return",
      'import React from "react"; export function Preview() { if (typeof window === "undefined") return <div />; return <div />; }',
      0,
    ],
    [
      "initial mount return",
      'import { useState } from "react"; export function Preview() { const [mounted] = useState(false); if (!mounted) return null; if (typeof window === "undefined") return <div />; return <section />; }',
      0,
    ],
  ])("preserves %s", (_, source, expectedCount) => {
    const result = runRule(noHydrationBranchOnBrowserGlobal, source, { filename: "app/page.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
