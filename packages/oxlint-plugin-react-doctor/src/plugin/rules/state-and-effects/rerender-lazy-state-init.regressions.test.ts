import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderLazyStateInit } from "./rerender-lazy-state-init.js";

describe("rerender-lazy-state-init — regressions", () => {
  it("stays silent on useState(useContext(...)) — wrapping would call a hook conditionally", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [theme, setTheme] = useState(useContext(ThemeContext));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on useState(useCustomHook(...))", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(useLocalStorageDefault("k"));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on useState(React.useContext(...)) — member-form hook callee", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [theme] = useState(React.useContext(ThemeContext));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an expensive non-hook initializer call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(makeBigArray());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an expensive member-form non-hook initializer call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C() {
        const [v, setV] = useState(utils.makeBigArray());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // atomantic/PortOS MonthView: `useState(now.getMonth())` re-runs a native
  // Date getter that costs nanoseconds — lazy-wrapping it is pure noise.
  it("stays silent on trivial native Date getters", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function MonthView() {
        const now = new Date();
        const [year, setYear] = useState(now.getFullYear());
        const [month, setMonth] = useState(now.getMonth());
        const [timestamp, setTimestamp] = useState(Date.now());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a Date getter shadowed by an argument-taking call", () => {
    const result = runRule(
      rerenderLazyStateInit,
      `function C({ range }) {
        const [rows, setRows] = useState(calendar.getMonth(range));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
