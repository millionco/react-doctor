import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

describe("hook-use-state CommonJS provider mutation", () => {
  it.each([
    'React.__defineGetter__("useState", () => customState);',
    'React.__defineSetter__("useState", customSetter);',
    'React["__defineGetter__"]("useState", () => customState);',
    'React["__defineSetter__"]("useState", customSetter);',
  ])("declines the read-only exemption after %s", (mutation) => {
    const result = runRule(
      hookUseState,
      `const React = require("react");
      ${mutation}
      export const Panel = () => {
        const [stored] = React.useState(7);
        return <span>{stored}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'React.__defineGetter__("useState", () => customState);',
    'React.__defineSetter__("useState", customSetter);',
  ])("checks a component-local CommonJS provider after %s", (mutation) => {
    const result = runRule(
      hookUseState,
      `export const Panel = () => {
        const React = require("react");
        ${mutation}
        const [stored] = React.useState(7);
        return <span>{stored}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "",
    'React.createElement("span", null);',
    "const reference = React.useRef(null);",
    'const getter = React.__lookupGetter__("useState");',
    'const setter = React.__lookupSetter__("useState");',
    "const constructorName = React.constructor.name;",
  ])("preserves the exemption for ordinary provider reads: %s", (operation) => {
    const result = runRule(
      hookUseState,
      `const React = require("react");
      ${operation}
      export const Panel = () => {
        const [stored] = React.useState(7);
        return <span>{stored}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'React.__defineGetter__("useState", () => customState);',
    'React.__defineSetter__("useState", customSetter);',
  ])("retains the existing ESM provider refusal after %s", (mutation) => {
    const result = runRule(
      hookUseState,
      `import React from "react";
      ${mutation}
      export const Panel = () => {
        const [stored] = React.useState(7);
        return <span>{stored}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'React.__defineGetter__("useState", () => customState);',
    'React.__defineSetter__("useState", customSetter);',
  ])("preserves valid tuple syntax despite provider mutation: %s", (mutation) => {
    const result = runRule(
      hookUseState,
      `const React = require("react");
      ${mutation}
      export const Panel = () => {
        const [stored, setStored] = React.useState(7);
        return <span onClick={() => setStored(8)}>{stored}</span>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
