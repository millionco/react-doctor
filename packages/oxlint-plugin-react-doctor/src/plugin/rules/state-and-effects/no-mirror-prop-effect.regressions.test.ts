import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

describe("no-mirror-prop-effect — regressions", () => {
  it("stays silent on an initial-only prop re-seed that is also user-editable", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function Counter({ initialCount }) {
        const [count, setCount] = useState(initialCount);
        useEffect(() => { setCount(initialCount); }, [initialCount]);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // A controlled draft synced from a prop via an Effect is still the
  // documented anti-pattern (react.dev "You Might Not Need an Effect" §
  // adjusting state on prop change) — even with an onChange handler the
  // initial frame shows the stale value, so it must still fire.
  it("flags a controlled draft mirror that is also written from a handler", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function C({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a pure prop mirror", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function Form({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("value");
  });
});
