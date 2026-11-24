import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const source = `
import { useCallback, useLayoutEffect, useRef } from "react";
export const Counter = () => {
  const host = useRef<HTMLDivElement | null>(null);
  const holder = useRef<MutationObserver | null>(null);
  const start = useCallback(() => {
    const target = host.current;
    if (!target) return;
    if (holder.current) {
      holder.current.disconnect();
      holder.current = null;
    }
    const observer = new MutationObserver(() => console.count("change"));
    observer.observe(target, { childList: true });
    holder.current = observer;
  }, []);
  useLayoutEffect(() => {
    start();
    return () => {
      if (holder.current) {
        holder.current.disconnect();
        holder.current = null;
      }
    };
  }, [start]);
  return <div ref={host} />;
};
`;

const doubledOwner = source.replace(
  "  return <div",
  "  useLayoutEffect(() => { start(); }, [start]);\n  return <div",
);

describe("a MutationObserver owned by one layout effect", () => {
  it.each([
    ["native child list observer", source],
    [
      "native subtree observer",
      source.replace("childList: true", "childList: true, subtree: true"),
    ],
  ])("recognizes cleanup for a %s", (_description, input) => {
    const result = runRule(effectNeedsCleanup, input);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    ["two layout effects", doubledOwner],
    ["no stored observer", source.replace("holder.current = observer;", "")],
    [
      "a call before storing",
      source.replace("holder.current = observer;", "notify(); holder.current = observer;"),
    ],
    ["no previous disconnect", source.replace("holder.current.disconnect();", "")],
    ["no layout cleanup", source.replace("        holder.current.disconnect();", "")],
    [
      "an escaping setup function",
      source.replace("  return <div", "  expose(start);\n  return <div"),
    ],
    [
      "an escaping observer holder",
      source.replace("  return <div", "  expose(holder);\n  return <div"),
    ],
    [
      "an options getter",
      source.replace("childList: true", "get childList() { notify(); return true; }"),
    ],
    [
      "an overridden observer method",
      `globalThis.MutationObserver.prototype.observe = install;\n${source}`,
    ],
    [
      "a replaced disconnect through a prototype alias",
      `const methods = MutationObserver.prototype; methods.disconnect = () => {};\n${source}`,
    ],
    [
      "an escaped observer constructor",
      `const Observer = MutationObserver; expose(Observer);\n${source}`,
    ],
    [
      "an inherited observer options getter",
      `Object.defineProperty(Object.prototype, "attributes", { get() { notify(); return true; } });\n${source}`,
    ],
    [
      "a mutable React namespace",
      source
        .replace("import { useCallback", "import React, { useCallback")
        .replace(
          "export const Counter",
          "React.useLayoutEffect = setupWithoutCleanup;\nexport const Counter",
        )
        .replace("  useLayoutEffect(()", "  React.useLayoutEffect(()"),
    ],
    ["an unverified side-effect import", `import "./observer-shim.js";\n${source}`],
    ["a dynamic module import", `void import("./observer-shim.js");\n${source}`],
    [
      "a writable React default exposed as a named specifier",
      source.replace("import { useCallback", "import { default as React, useCallback"),
    ],
    [
      "a TypeScript import-equals module",
      `import compat = require("./observer-shim.js"); void compat;\n${source}`,
    ],
    ["a custom JSX runtime directive", `/** @jsxImportSource alternate-jsx */\n${source}`],
    ["a custom host ref", source.replace("<div ref={host}", "<Box ref={host}")],
    [
      "an additional assignment to the holder",
      source.replace("  return <div", "  holder.current = other;\n  return <div"),
    ],
  ])("retains the warning for %s", (_description, input) => {
    const result = runRule(effectNeedsCleanup, input);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
