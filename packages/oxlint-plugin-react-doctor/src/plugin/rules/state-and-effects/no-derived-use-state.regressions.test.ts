import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedUseState } from "./no-derived-use-state.js";

describe("no-derived-useState — regressions", () => {
  it("stays silent on a draft buffer re-seeded from the prop inside a nested handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor(props) {
        const [title, setTitle] = useState(props.title);
        const onFocus = () => setTitle(props.title);
        return <input value={title} onFocus={onFocus} onChange={(e) => setTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a destructured-prop draft buffer re-seeded in a nested handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor({ title }) {
        const [draftTitle, setDraftTitle] = useState(title);
        const beginEdit = () => setDraftTitle(title);
        return <input value={draftTitle} onFocus={beginEdit} onChange={(e) => setDraftTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a draft buffer re-seeded in a useCallback-wrapped handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor({ title }) {
        const [draftTitle, setDraftTitle] = useState(title);
        const beginEdit = useCallback(() => setDraftTitle(title), [title]);
        return <input value={draftTitle} onFocus={beginEdit} onChange={(e) => setDraftTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-during-render pattern with a prop-derived argument", () => {
    const result = runRule(
      noDerivedUseState,
      `function RadioGroup({ value }) {
        const [prevValue, setPrevValue] = useState(value);
        if (prevValue !== value) {
          setPrevValue(value);
        }
        return <div>{prevValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a plain stale prop copy with no re-seed", () => {
    const result = runRule(
      noDerivedUseState,
      `function Profile({ name }) {
        const [draftName, setDraftName] = useState(name);
        return <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the prop re-seed only happens inside an effect (genuine mirror)", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mirror re-seeded through a custom effect wrapper hook", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [current, setCurrent] = useState(value);
        useUpdateEffect(() => {
          setCurrent(value);
        }, [value]);
        return <span>{current}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mirror re-seeded inside a useMemo callback", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [current, setCurrent] = useState(value);
        const derived = useMemo(() => {
          setCurrent(value);
          return value.length;
        }, [value]);
        return <span>{derived}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the only render-phase setter call resets to an unrelated constant", () => {
    const result = runRule(
      noDerivedUseState,
      `function List({ items, page }) {
        const [visibleItems, setVisibleItems] = useState(items);
        if (page < 1) {
          setVisibleItems([]);
        }
        return <ul>{visibleItems.length}</ul>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
