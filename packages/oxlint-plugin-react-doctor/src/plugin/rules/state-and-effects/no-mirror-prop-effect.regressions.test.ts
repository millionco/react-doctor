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

  // Docs-validation r2: PortOS EditorialCheckCard — the effect re-seeds
  // the draft on [value, resetNonce]; the nonce is a deliberate second
  // trigger (revert after failed save), the doc's stated FP: "a transient
  // local edit that is intentionally re-synced to the prop on a separate
  // trigger".
  it("stays silent when the sync effect has an extra non-prop dep (separate trigger)", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function ConfigField({ value, resetNonce }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value, resetNonce]);
        return <input value={draft} onChange={(e) => setDraft(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when the extra dep is only the setter itself", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function C({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value, setDraft]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // Semi-controlled shapes (CAlert dismiss, editable color drafts) were
  // reviewed and deliberately kept firing: both confirmed TPs in the same
  // sample also write the state from handlers, and the doc's fix names
  // the editable-copy remedy ("key off the prop instead").
  it("still flags a mirror whose state is also written from a toggle handler", () => {
    const result = runRule(
      noMirrorPropEffect,
      `function Caption({ showThumbnails: showThumbnailsProp }) {
        const [showThumbnails, setShowThumbnails] = useState(showThumbnailsProp);
        useEffect(() => { setShowThumbnails(showThumbnailsProp); }, [showThumbnailsProp]);
        return <button onClick={() => setShowThumbnails((prev) => !prev)}>{String(showThumbnails)}</button>;
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
