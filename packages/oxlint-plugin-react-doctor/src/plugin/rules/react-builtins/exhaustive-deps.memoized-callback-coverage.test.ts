import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const SOURCE = `
  import * as React from "react";
  export const Panel = ({ onCancel, enabled, extra }) => {
    const cancel = React.useCallback(() => onCancel(), [onCancel]);
    const stop = React.useCallback(() => cancel(), [cancel]);
    React.useEffect(() => {
      if (enabled) stop();
      else cancel();
    }, [enabled, stop]);
    return null;
  };
`;

describe("exhaustive-deps memoized callback coverage", () => {
  it("accepts a direct read covered by the identity of a used memoized callback", () => {
    const result = runRule(exhaustiveDeps, SOURCE);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts explicitly imported React aliases", () => {
    const result = runRule(
      exhaustiveDeps,
      SOURCE.replace(
        'import * as React from "react";',
        'import { useCallback as useReactCallback, useEffect as useReactEffect } from "react";',
      )
        .replaceAll("React.useCallback", "useReactCallback")
        .replace("React.useEffect", "useReactEffect"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps another missing dependency", () => {
    const result = runRule(exhaustiveDeps, SOURCE.replace("else cancel();", "else cancel(extra);"));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("stale `extra`"),
    ]);
  });

  it("keeps the upstream missing-dependency diagnostic", () => {
    const result = runRule(exhaustiveDeps, SOURCE, {
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      expect.stringContaining("cancel"),
    ]);
  });

  it.each([
    ["unlisted memoized callback", SOURCE.replace("[enabled, stop]", "[enabled]")],
    [
      "unnecessary listed memoized callback",
      SOURCE.replace("if (enabled) stop();", "if (enabled) cancel();"),
    ],
    ["mutable missing dependency", SOURCE.replace("const cancel =", "let cancel =")],
    ["mutable listed dependency", SOURCE.replace("const stop =", "let stop =")],
    [
      "nonliteral callback",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const callback = () => cancel(); const stop = React.useCallback(callback, [cancel]);",
      ),
    ],
    [
      "stable reused callback",
      SOURCE.replace("export const Panel", "const callback = () => {}; export const Panel").replace(
        "React.useCallback(() => cancel(), [cancel])",
        "React.useCallback(callback, [cancel])",
      ),
    ],
    [
      "nonliteral memo dependencies",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const dependencies = [cancel]; const stop = React.useCallback(() => cancel(), dependencies);",
      ),
    ],
    [
      "conditional memo dependencies",
      SOURCE.replace(
        "React.useCallback(() => cancel(), [cancel])",
        "React.useCallback(() => cancel(), enabled ? [cancel] : [onCancel])",
      ),
    ],
    [
      "wrong memo dependency",
      SOURCE.replace(
        "React.useCallback(() => cancel(), [cancel])",
        "React.useCallback(() => cancel(), [onCancel])",
      ),
    ],
    [
      "shadowed memo dependency",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const stop = (() => { const cancel = () => {}; return React.useCallback(() => cancel(), [cancel]); })();",
      ),
    ],
    [
      "shadowed provider",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const stop = (() => { const React = { useCallback: () => () => {} }; return React.useCallback(() => cancel(), [cancel]); })();",
      ),
    ],
    [
      "unknown callback provider",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const stop = custom.useCallback(() => cancel(), [cancel]);",
      ),
    ],
    [
      "conditional memo call",
      SOURCE.replace(
        "const stop = React.useCallback(() => cancel(), [cancel]);",
        "const stop = enabled ? React.useCallback(() => cancel(), [cancel]) : () => {};",
      ),
    ],
    [
      "conditional effect call",
      SOURCE.replace("React.useEffect(", "if (enabled) React.useEffect("),
    ],
    [
      "an identically spelled local inside the memoized callback",
      SOURCE.replace(
        "React.useCallback(() => cancel(), [cancel])",
        "React.useCallback(() => { const cancel = () => {}; cancel(); }, [cancel])",
      ),
    ],
    [
      "duplicate dependencies on the memoized callback",
      SOURCE.replace(
        "React.useCallback(() => cancel(), [cancel])",
        "React.useCallback(() => cancel(), [cancel, cancel])",
      ),
    ],
  ])("keeps the missing dependency for %s", (_, code) => {
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContainEqual(
      expect.stringMatching(/useEffect.*stale.*cancel/u),
    );
  });

  it("preserves the duplicate report and the original missing report for duplicate deps", () => {
    const result = runRule(
      exhaustiveDeps,
      SOURCE.replace("[enabled, stop]", "[enabled, stop, stop]"),
    );
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);
    expect(messages).toContainEqual(expect.stringContaining("lists `stop` twice"));
    expect(messages).toContainEqual(expect.stringMatching(/useEffect.*stale.*cancel/u));
  });
});
