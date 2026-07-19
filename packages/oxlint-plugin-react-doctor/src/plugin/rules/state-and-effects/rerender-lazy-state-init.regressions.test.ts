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

  describe("fn-mining sweep: eager calls behind wrapper expressions", () => {
    it("flags an expensive call behind a nullish fallback", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ raw }) {
          const [rows, setRows] = useState(buildRows(raw) ?? []);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an expensive call spread into an array literal", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ raw }) {
          const [rows, setRows] = useState([...buildRows(raw)]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a constructor initializer", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ config }) {
          const [model, setModel] = useState(new HeavyModel(config));
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a member read off an expensive call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function Table({ width }) {
          const [sections, setSections] = useState(computeLayout(width).sections);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent on trivial built-in constructors", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [when, setWhen] = useState(new Date());
          const [seen, setSeen] = useState(new Set());
          const [byId, setById] = useState(new Map());
          const [weakSeen, setWeakSeen] = useState(new WeakSet());
          const [weakById, setWeakById] = useState(new WeakMap());
          const [controller, setController] = useState(new AbortController());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on an already-lazy empty-container initializer", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byId, setById] = useState(() => new Map());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent when only the conditional right side of a fallback is a call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ value }) {
          const [v, setV] = useState(value ?? getDefault());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on member reads that involve no call", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ config }) {
          const [sections, setSections] = useState(config.layout.sections);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a hook call behind a nullish fallback", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [theme, setTheme] = useState(useContext(ThemeContext) ?? "light");
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("fuzz sweep: trivial-constructor exemption is zero-argument + identifier-callee only", () => {
    it("flags a trivial-name construction with runtime arguments", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey, setByKey] = useState(new Map([["a", 1]]));
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags `new Date(timestamp)` while `new Date()` stays exempt", () => {
      const withArgument = runRule(
        rerenderLazyStateInit,
        `function C({ timestamp }) {
          const [startedAt] = useState(new Date(timestamp));
          return null;
        }`,
      );
      const zeroArgument = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [startedAt] = useState(new Date());
          return null;
        }`,
      );
      expect(withArgument.diagnostics).toHaveLength(1);
      expect(zeroArgument.diagnostics).toEqual([]);
    });

    it("flags a member-expression callee even when the property matches a trivial name", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey] = useState(new ns.Map());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays silent when only TYPE arguments are passed", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C() {
          const [byKey] = useState(new Map<string, number>());
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("flags a TS-wrapped expensive call (wrapper transparency)", () => {
      const result = runRule(
        rerenderLazyStateInit,
        `function C({ raw }) {
          const [rows, setRows] = useState(buildRows(raw) as Rows);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
