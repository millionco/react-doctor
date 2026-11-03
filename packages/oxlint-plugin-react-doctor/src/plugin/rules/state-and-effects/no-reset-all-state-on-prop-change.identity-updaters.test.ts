import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("no-reset-all-state-on-prop-change identity updaters", () => {
  it.each([
    "(currentValue?: number) => currentValue",
    "(currentValue?: string) => currentValue",
    "(currentValue?: number) => { return currentValue; }",
    "function (currentValue?: number) { return currentValue; }",
    "(currentValue?: number) => (currentValue as number | undefined)",
  ])("accepts the pure inline updater %s", (updater) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `function Editor({ itemId }) {
        const [value, setValue] = useState(${updater});
        useEffect(() => { setValue(${updater}); }, [itemId]);
        return <output>{value}</output>;
      }`,
      { filename: "editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const identity = (currentValue?: number) => currentValue;",
    "const original = (currentValue?: number) => currentValue; const identity = original;",
  ])("accepts the readonly updater binding %s", (declaration) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `${declaration}
      function Editor({ itemId }) {
        const [value, setValue] = useState(identity);
        useEffect(() => { setValue(identity); }, [itemId]);
        return <output>{value}</output>;
      }`,
      { filename: "editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "() => 0",
    "(currentValue = 0) => currentValue",
    "(...currentValues) => currentValues",
    "({ currentValue }) => currentValue",
    "async (currentValue?: number) => currentValue",
    "function* (currentValue?: number) { return currentValue; }",
    "(currentValue?: number) => { currentValue = 0; return currentValue; }",
    "(currentValue?: number) => { record(currentValue); return currentValue; }",
    "(currentValue?: number) => { { const currentValue = 0; return currentValue; } }",
    "((currentValue?: number) => currentValue).bind(null, 0)",
    "new Proxy((currentValue?: number) => currentValue, { apply: () => 0 })",
    "({ get identity() { return () => 0; } }).identity",
    "(() => { record(); return (currentValue?: number) => currentValue; })()",
  ])("retains the reset warning for %s", (updater) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `function Editor({ itemId }) {
        const [value, setValue] = useState(${updater});
        useEffect(() => { setValue(${updater}); }, [itemId]);
        return <output>{String(value)}</output>;
      }`,
      { filename: "editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains a guarded literal reset after a queued update", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `function Editor({ itemId, beforeReset }) {
        const [value, setValue] = useState(0);
        useEffect(() => {
          beforeReset(setValue);
          if (value === 0) setValue(0);
        }, [itemId]);
        return <output>{value}</output>;
      }`,
      { filename: "editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not resolve a function declaration reassigned in a catch default", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `function identity(currentValue) { return currentValue; }
      try { throw {}; } catch ({ ignored = (identity = () => 0) }) {}
      function Editor({ itemId }) {
        const [value, setValue] = useState(identity);
        useEffect(() => { setValue(identity); }, [itemId]);
        return <input value={value} onChange={() => setValue(42)} />;
      }`,
      { filename: "editor.jsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
