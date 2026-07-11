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
    [
      "Array.from mapping callback",
      `"use client"; export const Page = ({ rows }) => <ul>{Array.from(rows, () => <li>{window.innerWidth}</li>)}</ul>;`,
    ],
    [
      "const alias of Array.from",
      `"use client"; const mapFrom = Array.from; export const Page = ({ rows }) => <ul>{mapFrom(rows, () => <li>{window.innerWidth}</li>)}</ul>;`,
    ],
    [
      "aliased React useMemo",
      `import { useMemo as memoize } from "react"; export const Page = () => { const width = memoize(() => window.innerWidth, []); return <div>{width}</div>; };`,
    ],
    [
      "a client-looking prop with unsafe polarity",
      `"use client"; export const Page = ({ mounted }) => !mounted && <div>{window.innerWidth}</div>;`,
    ],
    [
      "a client-looking prop before an unsafe early return",
      `"use client"; export const Page = ({ mounted }) => { if (mounted) return null; return <div>{window.innerWidth}</div>; };`,
    ],
    [
      "a local useState lookalike",
      `"use client"; const useState = () => [true]; export const Page = () => { const [mounted] = useState(false); return mounted && <div>{window.innerWidth}</div>; };`,
    ],
    [
      "a shadowed alias of mounted state",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); const ready = mounted; return [true].map((ready) => ready && window.innerWidth); };`,
    ],
    [
      "a browser read behind state with a lazy true initializer",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(() => true); return mounted && window.innerWidth; };`,
    ],
    [
      "a browser read behind state with an unknown initializer",
      `import { useState } from "react"; export const Page = ({ initialMounted }) => { const [mounted] = useState(initialMounted); return mounted && window.innerWidth; };`,
    ],
    [
      "a browser read behind state with a mutated initializer alias",
      `import { useState } from "react"; export const Page = () => { let initialMounted = false; initialMounted = true; const [mounted] = useState(initialMounted); return mounted && window.innerWidth; };`,
    ],
    [
      "a browser read behind an initially false OR operand",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); return mounted || window.innerWidth; };`,
    ],
    [
      "a browser read whose availability exit is in a sibling useMemo factory",
      `import { useMemo } from "react"; export const Page = () => { useMemo(() => { if (typeof window === "undefined") return 0; return 1; }, []); return useMemo(() => window.innerWidth, []); };`,
    ],
    [
      "a browser read after an exit in an unrelated inner function",
      `import { useMemo } from "react"; export const Page = () => useMemo(() => { const guard = () => { if (typeof window === "undefined") return; }; return window.innerWidth; }, []);`,
    ],
    [
      "a nested render callback whose own body has no availability exit",
      `import { useMemo } from "react"; export const Page = () => { if (typeof window === "undefined") return null; return useMemo(() => window.innerWidth, []); };`,
    ],
    [
      "a render read after an availability exit in a timer callback",
      `"use client"; export const Page = () => { setTimeout(() => { if (typeof window === "undefined") return; }, 0); return window.innerWidth; };`,
    ],
    [
      "a render read after an availability exit in a promise callback",
      `"use client"; export const Page = () => { Promise.resolve().then(() => { if (typeof document === "undefined") return; }); return document.title; };`,
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
      "a globalThis typeof guard",
      `"use client"; export const Page = () => <div>{typeof globalThis.window !== "undefined" ? globalThis.window.innerWidth : 0}</div>;`,
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
      "an early-exit guard with exhaustive inner branches",
      `"use client"; export const Page = ({ shouldThrow }) => { if (typeof window === "undefined") { if (shouldThrow) throw new Error("server"); else return null; } return <div>{window.innerWidth}</div>; };`,
    ],
    [
      "an availability exit in a lazy useState initializer",
      `import { useState } from "react"; export const Page = () => { const [width] = useState(() => { if (typeof window === "undefined") return 0; return window.innerWidth; }); return <div>{width}</div>; };`,
    ],
    [
      "an availability exit in a useMemo factory",
      `import { useMemo } from "react"; export const Page = () => { const width = useMemo(() => { if (typeof window === "undefined") return 0; return window.innerWidth; }, []); return <div>{width}</div>; };`,
    ],
    [
      "an availability exit in an IIFE",
      `"use client"; export const Page = () => <div>{(() => { if (typeof window === "undefined") return 0; return window.innerWidth; })()}</div>;`,
    ],
    [
      "an availability exit in a synchronous map callback",
      `"use client"; export const Page = ({ rows }) => <ul>{rows.map(() => { if (typeof window === "undefined") return null; return <li>{window.innerWidth}</li>; })}</ul>;`,
    ],
    [
      "an availability exit in an Array.from callback",
      `"use client"; export const Page = ({ rows }) => <ul>{Array.from(rows, () => { if (typeof window === "undefined") return null; return <li>{window.innerWidth}</li>; })}</ul>;`,
    ],
    [
      "an availability exit in a nested render-phase block",
      `import { useMemo } from "react"; export const Page = ({ ready }) => useMemo(() => { if (ready) { if (typeof window === "undefined") return 0; return window.innerWidth; } return 0; }, [ready]);`,
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
    [
      "a const alias of mounted state",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); const ready = mounted; return <div>{ready && window.innerWidth}</div>; };`,
    ],
    [
      "an initially true OR short-circuit gate",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(false); return <div>{!mounted || window.innerWidth}</div>; };`,
    ],
    [
      "a nested initially true OR short-circuit gate",
      `import { useState } from "react"; export const Page = ({ ready }) => { const [mounted] = useState(false); return <div>{!mounted || (ready && window.innerWidth)}</div>; };`,
    ],
    [
      "a falsy state gate with a lazy initializer",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(() => false); return <div>{mounted && window.innerWidth}</div>; };`,
    ],
    [
      "a falsy state gate with unary negation",
      `import { useState } from "react"; export const Page = () => { const [mounted] = useState(!true); return <div>{mounted && window.innerWidth}</div>; };`,
    ],
    [
      "a falsy state gate with an immutable initializer alias",
      `import { useState } from "react"; export const Page = () => { const initialMounted = false; const [mounted] = useState(initialMounted); return <div>{mounted && window.innerWidth}</div>; };`,
    ],
    [
      "a browser read in a timer callback",
      `"use client"; export const Page = () => { setTimeout(() => window.innerWidth, 0); return null; };`,
    ],
    [
      "a browser read in a promise callback",
      `"use client"; export const Page = () => { Promise.resolve().then(() => document.title); return null; };`,
    ],
    [
      "a shadowed Array.from lookalike",
      `"use client"; export const Page = ({ Array }) => <div>{Array.from([], () => window.innerWidth)}</div>;`,
    ],
  ])("stays quiet for a browser read in %s", (_name, code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("names matchMedia in its diagnostic", () => {
    const result = run(
      `import { useMemo } from "react"; export const Page = () => { const mobile = useMemo(() => matchMedia("(max-width: 600px)").matches, []); return <div>{String(mobile)}</div>; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`matchMedia`");
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
