import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

const source = `
  import { createPortal } from "react-dom";
  import { useEffect, useState } from "react";
  import { Presence } from "motion/react";

  export function Wrapper({ show }) {
    const [ready, setReady] = useState(false);
    useEffect(() => setReady(true), []);
    if (!ready) return null;
    return createPortal(<Presence>{show && <PrivateSurface />}</Presence>, document.body);
  }

  function PrivateSurface() {
    return <span>{window.innerWidth}</span>;
  }
`;

const run = (code: string) =>
  runRule(noUnguardedBrowserGlobalInRenderOrHookInit, code, {
    filename: "src/components/private-surface.tsx",
  });

describe("private child mounted by an effect", () => {
  it.each([
    source,
    source.replace(
      "return createPortal(<Presence>{show && <PrivateSurface />}</Presence>, document.body);",
      "return <Presence>{show && <PrivateSurface />}</Presence>;",
    ),
  ])("accepts the sole child use after the parent gate", (code) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "an exported child",
      code: source.replace("function PrivateSurface()", "export function PrivateSurface()"),
    },
    { name: "a re-exported child", code: source + "export { PrivateSurface };" },
    { name: "a second use", code: source + "export const Sibling = () => <PrivateSurface />;" },
    {
      name: "an ordinary child call",
      code: source + "export const Direct = () => PrivateSurface();",
    },
    { name: "an initially open gate", code: source.replace("useState(false)", "useState(true)") },
    { name: "an unrelated guard", code: source.replace("if (!ready)", "if (!show)") },
    {
      name: "an opaque setter call",
      code: source.replace("    useEffect", "    shareSetter(setReady);\n    useEffect"),
    },
    {
      name: "a render-phase setter",
      code: source.replace("    useEffect", "    if (show) setReady(true);\n    useEffect"),
    },
    {
      name: "a lookalike effect",
      code: source.replace(
        'import { useEffect, useState } from "react";',
        'import { useState } from "react"; import { useEffect } from "fake-react";',
      ),
    },
    {
      name: "an eval escape",
      code: source + 'export const reveal = () => eval("PrivateSurface");',
    },
  ])("retains the browser read for $name", ({ code }) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some(({ message }) => message.includes("`window`"))).toBe(true);
  });
});

const shortCircuitSource = `
  import { useEffect, useState } from "react";

  export function Screen() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      setMounted(true);
      return () => setMounted(false);
    }, []);
    return (
      <div>
        <button onClick={() => setMounted(false)}>Hide</button>
        {mounted && <Viewport />}
      </div>
    );
  }

  const Viewport = () => <output>{window.innerWidth}</output>;
`;

describe("module-private arrow child behind a short-circuit mount gate", () => {
  it("accepts the sole guarded JSX use with direct false resets", () => {
    const result = run(shortCircuitSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "a child alias used without the mount gate",
      code:
        shortCircuitSource + "const Alias = Viewport; export const Alternate = () => <Alias />;",
    },
    {
      name: "an eager true write before the effect",
      code: shortCircuitSource.replace(
        "    useEffect(",
        "    if (!mounted) setMounted(true);\n    useEffect(",
      ),
    },
    {
      name: "a gate initialized to true",
      code: shortCircuitSource.replace("useState(false)", "useState(true)"),
    },
    {
      name: "an ordinary direct invocation",
      code: shortCircuitSource + "export const Alternate = () => Viewport();",
    },
    {
      name: "a second unguarded JSX use",
      code: shortCircuitSource + "export const Alternate = () => <Viewport />;",
    },
  ])("retains the browser read for $name", ({ code }) => {
    const result = run(code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some(({ message }) => message.includes("`window`"))).toBe(true);
  });
});
