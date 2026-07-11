import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const run = (code: string, filename = "app/page.tsx") =>
  runRule(noUnguardedBrowserGlobalInRenderOrHookInit, code, { filename });

describe("no-unguarded-browser-global-in-render-or-hook-init", () => {
  it.each([
    ["render body", `"use client"; export const Page = () => <div>{window.innerWidth}</div>;`],
    [
      "eager state initializer",
      `import { useState } from "react"; export const Page = () => { const [width] = useState(window.innerWidth); return <div>{width}</div>; };`,
    ],
    [
      "lazy state initializer",
      `import { useState } from "react"; export const Page = () => { const [value] = useState(() => localStorage.getItem("theme")); return <div>{value}</div>; };`,
    ],
    [
      "ref initializer",
      `import { useRef } from "react"; export const Page = () => { const value = useRef(document.body); return <div>{String(value.current)}</div>; };`,
    ],
    [
      "useMemo",
      `import { useMemo } from "react"; export const Page = () => { const mobile = useMemo(() => matchMedia("(max-width: 600px)").matches, []); return <div>{String(mobile)}</div>; };`,
    ],
    ["IIFE", `"use client"; export const Page = () => <div>{(() => navigator.language)()}</div>;`],
    [
      "synchronous callback",
      `"use client"; export const Page = ({ rows }) => <ul>{rows.map(() => <li>{sessionStorage.length}</li>)}</ul>;`,
    ],
  ])("reports an unguarded browser read in %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "an effect",
      `import { useEffect } from "react"; export const Page = () => { useEffect(() => console.log(window.innerWidth), []); return null; };`,
    ],
    [
      "an event handler",
      `"use client"; export const Page = () => <button onClick={() => console.log(document.title)}>read</button>;`,
    ],
    [
      "a typeof guard",
      `"use client"; export const Page = () => <div>{typeof window !== "undefined" ? window.innerWidth : 0}</div>;`,
    ],
    [
      "a short-circuit guard",
      `"use client"; export const Page = () => <div>{typeof document !== "undefined" && document.title}</div>;`,
    ],
    [
      "an OR short-circuit guard",
      `"use client"; export const Page = () => <div>{typeof window === "undefined" || window.innerWidth}</div>;`,
    ],
    [
      "a wrapped typeof guard",
      `"use client"; export const Page = () => <div>{typeof (window as unknown) !== "undefined" ? window.innerWidth : 0}</div>;`,
    ],
    [
      "a document guard for another browser global",
      `"use client"; export const Page = () => <div>{typeof document !== "undefined" ? window.innerWidth : 0}</div>;`,
    ],
    [
      "an object-type browser guard",
      `"use client"; export const Page = () => <div>{typeof window === "object" ? window.innerWidth : 0}</div>;`,
    ],
    [
      "a function-type browser API guard",
      `"use client"; export const Page = () => <div>{typeof matchMedia === "function" ? String(matchMedia("(min-width: 800px)").matches) : "false"}</div>;`,
    ],
    [
      "a compound availability guard",
      `"use client"; export const Page = ({ ready }) => <div>{typeof window !== "undefined" && ready ? window.innerWidth : 0}</div>;`,
    ],
    [
      "a guard around a synchronous render callback",
      `"use client"; export const Page = ({ rows }) => { if (typeof window !== "undefined") return <>{rows.map(() => window.innerWidth)}</>; return null; };`,
    ],
    [
      "a matchMedia availability guard",
      `"use client"; export const Page = () => <div>{typeof matchMedia !== "undefined" ? String(matchMedia("(max-width: 600px)").matches) : "false"}</div>;`,
    ],
    [
      "an early-return guard",
      `"use client"; export const Page = () => { if (typeof window === "undefined") return null; return <div>{window.innerWidth}</div>; };`,
    ],
    [
      "a shadowed binding",
      `"use client"; export const Page = ({ window }) => <div>{window.innerWidth}</div>;`,
    ],
    [
      "a plain helper",
      `"use client"; const readWidth = () => window.innerWidth; export const Page = () => <div>{readWidth()}</div>;`,
    ],
    [
      "a falsy initial visibility gate",
      `import { useState } from "react"; export const Page = () => { const [open] = useState(false); return <div>{open && window.innerWidth}</div>; };`,
    ],
    [
      "a mounted early-return gate",
      `import { useEffect, useState } from "react"; export const Page = () => { const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); if (!mounted) return null; return <div>{window.innerWidth}</div>; };`,
    ],
  ])("stays quiet for a browser read in %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips test, native, email, and generated-image contexts", () => {
    expect(
      run(`export const Page = () => <div>{window.innerWidth}</div>;`, "app/page.test.tsx")
        .diagnostics,
    ).toEqual([]);
    expect(
      run(
        `export const Page = () => <div>{window.innerWidth}</div>;`,
        "packages/mobile/App.native.tsx",
      ).diagnostics,
    ).toEqual([]);
    expect(
      run(
        `import { Text } from "@react-email/components"; export const Mail = () => <Text>{window.innerWidth}</Text>;`,
      ).diagnostics,
    ).toEqual([]);
    expect(
      run(
        `import { ImageResponse } from "next/og"; export const GET = () => new ImageResponse(<div>{window.innerWidth}</div>);`,
      ).diagnostics,
    ).toEqual([]);
  });
});
