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

  it("stays silent on a controlled/uncontrolled draft mirror also written from a handler", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function C({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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
