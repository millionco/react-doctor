import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("react-builtins/exhaustive-deps reassigned functions", () => {
  it.each([
    ["conditional assignment", "if (enabled) run = () => setValue(1);"],
    ["unconditional assignment", "run = () => setValue(enabled);"],
    ["logical assignment", "run &&= () => setValue(enabled);"],
    ["array destructuring", "[run] = handlers;"],
    ["object destructuring", "({ run } = handlers);"],
    ["nested destructuring", "({ handlers: [run] } = handlers);"],
    ["destructuring default", "({ run = () => setValue(enabled) } = handlers);"],
    ["for-of assignment", "for (run of handlers) break;"],
    ["for-of destructuring", "for ({ run } of handlers) break;"],
    ["TypeScript assignment", "(run as (() => void)) = handlers[0];"],
  ])("requires a callback dependency after %s", (_name, reassignment) => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState } from "react";
      const Widget = ({ enabled, handlers }) => {
        const [value, setValue] = useState(0);
        let run = () => setValue(0);
        ${reassignment}
        useEffect(() => { run(); }, []);
        return value;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`run`");
  });

  it("requires a reassigned function declaration", () => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState } from "react";
      const Widget = ({ enabled }) => {
        const [value, setValue] = useState(0);
        function run() { setValue(0); }
        if (enabled) run = () => setValue(1);
        useEffect(() => { run(); }, []);
        return value;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`run`");
  });

  it("requires a function that captures a rebound recursive function", () => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState } from "react";
      const Widget = ({ enabled }) => {
        const [value, setValue] = useState(0);
        let first = (count) => count ? second(count - 1) : 0;
        const second = (count) => count ? first(count - 1) : 0;
        if (enabled) first = () => 1;
        useEffect(() => { setValue(second(1)); }, []);
        return value;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("`second`");
  });

  it.each([
    ["const callback", "const run = () => setValue(0);"],
    ["read-only let callback", "let run = () => setValue(0);"],
    ["read-only var callback", "var run = () => setValue(0);"],
    ["function declaration", "function run() { setValue(0); }"],
    [
      "read-only recursive functions",
      `const first = (count) => count ? second(count - 1) : 0;
      const second = (count) => count ? first(count - 1) : 0;
      const run = () => setValue(second(1));`,
    ],
    [
      "a shadowed assignment",
      `const run = () => setValue(0);
      const replace = (run) => { run = () => 1; };
      replace(() => 0);`,
    ],
    [
      "a callback used as a computed assignment key",
      `const run = () => setValue(0);
      ({ [run]: other } = handlers);`,
    ],
    [
      "a callback used as a destructuring default value",
      `const run = () => setValue(0);
      ({ other = run } = handlers);`,
    ],
    [
      "a callback property assignment",
      `const run = () => setValue(0);
      run.description = "reset";`,
    ],
  ])("preserves the stable exemption for %s", (_name, declaration) => {
    const result = runRule(
      exhaustiveDeps,
      `import { useEffect, useState } from "react";
      const Widget = ({ handlers }) => {
        const [value, setValue] = useState(0);
        let other;
        ${declaration}
        useEffect(() => { run(); }, []);
        return value;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
