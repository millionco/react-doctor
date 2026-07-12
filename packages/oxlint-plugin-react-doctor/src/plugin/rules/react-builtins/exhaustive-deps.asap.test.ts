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
