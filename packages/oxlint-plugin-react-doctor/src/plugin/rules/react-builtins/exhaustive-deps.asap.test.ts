import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

describe("exhaustive-deps — every-commit converging setters", () => {
  it("accepts an intentional every-commit layout effect", () => {
    const result = runRule(
      exhaustiveDeps,
      `function VisualContext() {
        const [visualContext, setVisualContext] = useState("");
        useLayoutEffect(() => {
          const next = readAncestorClass();
          setVisualContext((previous) => previous === next ? previous : next);
        });
        return visualContext;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still rejects a non-converging every-commit state update", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Counter({ enabled }) {
        const [count, setCount] = useState(0);
        useEffect(() => setCount((previous) => enabled ? previous : previous + 1));
        return count;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["{}", "[]", "new Map()"])(
    "still rejects an equality guard against a fresh %s value",
    (freshValue) => {
      const result = runRule(
        exhaustiveDeps,
        `function Snapshot() {
          const [snapshot, setSnapshot] = useState(null);
          useEffect(() => {
            const next = ${freshValue};
            setSnapshot((previous) => previous === next ? previous : next);
          });
          return snapshot;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still rejects fresh values hidden behind const aliases and fallbacks", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Snapshot({ value }) {
        const [snapshot, setSnapshot] = useState(null);
        useEffect(() => {
          const empty = {};
          const fallback = empty;
          const next = value ?? fallback;
          setSnapshot((previous) => previous === next ? previous : next);
        });
        return snapshot;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still rejects reassigned compared bindings", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Snapshot() {
        const [snapshot, setSnapshot] = useState(null);
        useEffect(() => {
          let next = readSnapshot();
          next = {};
          setSnapshot((previous) => previous === next ? previous : next);
        });
        return snapshot;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("exhaustive-deps — direct setter bailout precision", () => {
  it("accepts the DOM-derived primitive state update from the reported Cloudscape trial", () => {
    const result = runRule(
      exhaustiveDeps,
      `const contextMatch = /awsui-context-([\\w-]+)/;
      function useVisualContext(elementRef) {
        const [value, setValue] = useState("");
        useLayoutEffect(() => {
          if (elementRef.current) {
            const contextParent = findUpUntil(
              elementRef.current,
              node => Boolean(node.className.match(contextMatch)),
            );
            setValue(contextParent?.className.match(contextMatch)?.[1] ?? "");
          }
        });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'setValue(elementRef.current?.className ?? "")',
    "setValue(value)",
    "setValue(STABLE_VALUE)",
    "setValue(true)",
    'setValue("iphone")',
    "setValue(Children.toArray(children).length)",
    "setValue((previous) => previous)",
    "setValue((previous) => (previous === nextValue ? previous : nextValue))",
    'setValue((previous) => { if (nextValue === "ready") return previous; return previous + 1; })',
    "setValue((previous) => { previous.ready = true; return previous; })",
    "setValue(Object.assign(value, { ready: true }))",
    "setValue(new Object(value))",
    "setValue(nextValue)",
  ])("accepts the potentially converging update %s", (setterStatement) => {
    const result = runRule(
      exhaustiveDeps,
      `const STABLE_VALUE = "ready";
      function Example({ nextValue, elementRef }) {
        const [value, setValue] = useState("");
        useEffect(() => { ${setterStatement}; });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "setValue({ ready: true })",
    "setValue({ ...value })",
    "setValue([])",
    "setValue([...value])",
    "setValue(<span />)",
    "setValue(/ready/)",
    "setValue(Array())",
    "setValue(Array(value))",
    "setValue(Object())",
    "setValue(new Map())",
    "setValue(new Map(value))",
    "setValue(new Object())",
    "setValue(new RegExp(value))",
    "setValue(value + 1)",
    "setValue(value - 1)",
    "setValue((previous) => previous + 1)",
    "setValue((previous) => { return previous + 1; })",
    "setValue((previous) => !previous)",
    "setValue((previous) => ({ previous }))",
  ])("reports the render-changing update %s", (setterStatement) => {
    const result = runRule(
      exhaustiveDeps,
      `function Example() {
        const [value, setValue] = useState(0);
        useEffect(() => { ${setterStatement}; });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows direct aliases of the setter and state value", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Example() {
        const [value, setValue] = useState(0);
        const currentValue = value;
        const updateValue = setValue;
        useEffect(() => { updateValue(currentValue + 1); });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows multi-hop aliases through TypeScript expression wrappers", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Example() {
        const [value, setValue] = useState(0);
        const currentValue = value as number;
        const firstUpdate = setValue;
        const updateValue = firstUpdate!;
        useEffect(() => { updateValue((currentValue) + 1); });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports render-changing updates behind branches and early returns", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Example({ ready }) {
        const [value, setValue] = useState(null);
        useEffect(() => {
          if (!ready) return;
          if (value) setValue([]);
          else setValue({ ready });
        });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts multiple guarded primitive resets in one every-commit effect", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Extension({ openDialog }) {
        const [name, setName] = useState("ready");
        const [code, setCode] = useState("saved");
        const [isActive, setIsActive] = useState(true);
        useEffect(() => {
          if (!openDialog) {
            setName("");
            setCode("");
            setIsActive(false);
          }
        });
        return name + code + isActive;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports fresh local aliases but accepts module-scope object references", () => {
    const freshResult = runRule(
      exhaustiveDeps,
      `function Example() {
        const [, setValue] = useState(null);
        const freshValue = { ready: true };
        useEffect(() => { setValue(freshValue); });
        return null;
      }`,
    );
    const stableResult = runRule(
      exhaustiveDeps,
      `const stableValue = { ready: true };
      function Example() {
        const [, setValue] = useState(null);
        useEffect(() => { setValue(stableValue); });
        return null;
      }`,
    );
    expect(freshResult.parseErrors).toEqual([]);
    expect(freshResult.diagnostics).toHaveLength(1);
    expect(stableResult.parseErrors).toEqual([]);
    expect(stableResult.diagnostics).toEqual([]);
  });

  it("ignores userland setter names and deferred React setters", () => {
    const userlandResult = runRule(
      exhaustiveDeps,
      `function Example() {
        const setValue = (value) => value;
        useEffect(() => { setValue({ ready: true }); });
        return null;
      }`,
    );
    const deferredResult = runRule(
      exhaustiveDeps,
      `function Example() {
        const [value, setValue] = useState(null);
        useEffect(() => { queueMicrotask(() => setValue({ ready: true })); });
        return value;
      }`,
    );
    expect(userlandResult.parseErrors).toEqual([]);
    expect(userlandResult.diagnostics).toEqual([]);
    expect(deferredResult.parseErrors).toEqual([]);
    expect(deferredResult.diagnostics).toEqual([]);
  });

  it("does not treat shadowed constructors as proof of fresh state", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Example({ stableValue }) {
        const Array = () => stableValue;
        const Object = () => stableValue;
        const Map = function () { return stableValue; };
        const [value, setValue] = useState(null);
        useEffect(() => {
          setValue(Array(value));
          setValue(Object());
          setValue(new Map());
        });
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not run the every-commit check when dependencies are present", () => {
    const result = runRule(
      exhaustiveDeps,
      `function Example({ value }) {
        const [, setValue] = useState(null);
        useEffect(() => { setValue({ value }); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
