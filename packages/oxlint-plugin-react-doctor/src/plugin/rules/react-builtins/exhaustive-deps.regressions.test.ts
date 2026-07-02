import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("react-builtins/exhaustive-deps — regressions", () => {
  // A module-scope constant used only as a parameter default is stable
  // across renders, so it must NOT be reported as a missing dependency.
  // Previously a manual (unfiltered) param-default walk added it
  // unconditionally; the scope analyzer now records the reference so the
  // normal module-scope filter excludes it.
  it("does not flag a module-scope constant used as a parameter default", () => {
    const code = `
      const SOME_MODULE_CONST = { a: 1 };
      function MyComponent() {
        return useCallback((opts = SOME_MODULE_CONST) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("SOME_MODULE_CONST");
  });

  // A Solid-style accessor call listed in deps (`[language.intl()]`)
  // declares the same member chain the capture side keys (`language.intl`),
  // so it must NOT be reported as a missing dep / complex dep.
  it("does not flag a member accessor call listed in deps", () => {
    const code = `
      function MyComponent({ language }) {
        useEffect(() => {
          console.log(language.intl());
        }, [language.intl()]);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("language");
    expect(messages).not.toContain("complex");
  });

  it("does not flag a bare accessor call listed in deps", () => {
    const code = `
      function MyComponent({ activeFileTab }) {
        useEffect(() => {
          console.log(activeFileTab());
        }, [activeFileTab()]);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("activeFileTab");
  });

  // Regression guard for the other direction: a genuine component-scope
  // value used as a parameter default is still reported when omitted from
  // the dependency array (the fix must not silence real findings).
  it("still flags a component-scope value used as a parameter default", () => {
    const code = `
      function MyComponent({ value }) {
        return useCallback((opts = value) => opts, []);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("value");
  });

  // The render callback passed directly to forwardRef/memo is a
  // component by construction, even under a non-PascalCase binding
  // (`const _Wrapped = forwardRef(...)`). Without that promotion the
  // component-scope boundary resolves to null and captures from an
  // enclosing factory scope are wrongly reported as missing deps —
  // they live outside the component, so they can't change between
  // renders.
  it("does not flag factory-scope captures inside a forwardRef callback under an underscore-prefixed binding", () => {
    const code = `
      import { forwardRef, useEffect } from "react";
      const buildComponent = (logger) => {
        const _Wrapped = forwardRef((props, ref) => {
          useEffect(() => {
            logger(props.value);
          }, [props.value]);
          return <div ref={ref} />;
        });
        return _Wrapped;
      };
    `;
    const result = runRule(exhaustiveDeps, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).not.toContain("logger");
  });

  // A computed member anywhere in a zero-arg call's callee
  // (`items[index]()`) is a dynamic per-render lookup — keying it by
  // the collapsed root name would silently satisfy the `items` capture.
  // It must stay a complex dep.
  it("reports a complex dep for a computed-member callee call", () => {
    const code = `
      function MyComponent({ items, index, other }) {
        useEffect(() => {
          console.log(other);
        }, [items[index]()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
  });

  it("does not let a computed-member callee call satisfy the root capture", () => {
    const code = `
      function MyComponent({ items, index }) {
        useEffect(() => {
          console.log(items[0]);
        }, [items[index]()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).toContain("`items`");
  });

  // A zero-arg call of a component-scope function rebuilt every render
  // must fire the same unstable-dep warning as the identifier form —
  // the memo re-runs every render either way.
  it("flags a zero-arg call of an unstable local function in deps", () => {
    const code = `
      function MyComponent({ data }) {
        const getConfig = () => ({ mode: data.mode });
        const value = useMemo(() => transform(getConfig()), [getConfig()]);
        return value;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("`getConfig` is rebuilt every render");
  });

  it("still flags the identifier form of an unstable local function dep", () => {
    const code = `
      function MyComponent({ data }) {
        const getConfig = () => ({ mode: data.mode });
        const value = useMemo(() => transform(getConfig()), [getConfig]);
        return value;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("`getConfig` is rebuilt every render");
  });

  // Solid signal accessors are not function-value symbols, so the
  // unstable-dep gate must not fire on them.
  it("stays silent on a Solid signal accessor call in deps", () => {
    const code = `
      function Counter() {
        const [count] = createSignal(0);
        useEffect(() => {
          console.log(count());
        }, [count()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The real opencode Solid-port shape the accessor fix targeted —
  // must stay fully silent.
  it("stays silent on the opencode Solid-port member accessor shape", () => {
    const code = `
      import { useLanguage } from "@/context/language";
      function SessionContextTab() {
        const language = useLanguage();
        const usd = useMemo(
          () =>
            new Intl.NumberFormat(language.intl(), {
              style: "currency",
              currency: "USD",
            }),
          [language.intl()],
        );
        const formatter = useMemo(
          () => createSessionContextFormatter(language.intl()),
          [language.intl()],
        );
        return usd.format(1) + String(formatter);
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // An UNUSED zero-arg call dep re-runs the hook because the call
  // RESULT changes every render, not because the callee binding
  // changes — the callee-keyed unnecessary-dep message would be
  // factually wrong, so the complex-expression message fires instead.
  it("reports a complex dep, not an unnecessary dep, for an unused Date.now() dep", () => {
    const code = `
      function MyComponent({ label }) {
        useEffect(() => {
          console.log(label);
        }, [label, Date.now()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).not.toContain("re-runs whenever `Date.now` changes");
  });

  it("reports a complex dep for an unused imported zero-arg call dep", () => {
    const code = `
      import { uuid } from "./uuid";
      function MyComponent({ label }) {
        useEffect(() => {
          console.log(label);
        }, [label, uuid()]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
    expect(messages).not.toContain("re-runs whenever `uuid` changes");
  });

  // FN anchors: the react-big-calendar timegutter planted bugs list
  // zero-arg calls in deps but the callbacks capture the bare objects —
  // the accessor keying must not swallow the missing-dep reports.
  it("still reports the timegutter planted useMemo bug", () => {
    const code = `
      import { adjustForDST } from './utils';
      const TimeGutter = ({ min, max, timeslots, step, localizer, components }) => {
        const { start, end } = useMemo(
          () => adjustForDST({ min, max, localizer }),
          [min?.toISOString(), max?.toISOString(), localizer]
        );
        return start && end ? null : null;
      };
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("min");
    expect(messages).toContain("max");
  });

  it("still reports the timegutter planted useEffect bug", () => {
    const code = `
      import { getSlotMetrics } from './utils';
      const TimeGutter = ({ min, max, timeslots, step, localizer }) => {
        const [slotMetrics, setSlotMetrics] = useState(
          getSlotMetrics({ min, max, timeslots, step, localizer })
        );
        useEffect(() => {
          if (slotMetrics) {
            setSlotMetrics(
              slotMetrics.update({ min, max, timeslots, step, localizer })
            );
          }
        }, [min?.toISOString(), max?.toISOString(), timeslots, step]);
        return null;
      };
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages).toContain("localizer");
  });

  it("still reports a call with arguments in deps as complex", () => {
    const code = `
      function MyComponent({ compute, value }) {
        useEffect(() => {
          console.log(compute(value));
        }, [compute(value)]);
        return null;
      }
    `;
    const result = runRule(exhaustiveDeps, code);
    expect(result.parseErrors).toEqual([]);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
    expect(messages).toContain("A complex expression");
  });
});
