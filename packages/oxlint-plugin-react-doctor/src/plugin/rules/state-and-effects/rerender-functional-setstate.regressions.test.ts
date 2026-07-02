import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

describe("rerender-functional-setstate — regressions", () => {
  // A subscription handler registered inside an effect closes over the state
  // captured at registration; multiple events before the next re-subscribe all
  // read the same stale value (the canonical react.dev bug). Being listed in
  // the effect deps does NOT make it safe, so this must still fire.
  it("flags a deferred setter even when the read state is an effect dependency", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [messages, setMessages] = useState([]);
        useEffect(() => {
          return subscribe((received) => setMessages([...messages, received]));
        }, [messages]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a deferred setter when the state is not in the effect deps", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const id = setInterval(() => setCount(count + 1), 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // react-bench-2 anchor (fix-react-rdh-innovaccer-design-system-pagination):
  // arithmetic setter reads inside a synchronous click handler must fire —
  // batched events (double-click before the next render) still lose updates,
  // so the functional form is the fix even without a deferred wrapper.
  it("flags setPage(page - 1) arithmetic inside a synchronous click handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Pagination({ onPageChange }) {
        const [page, setPage] = useState(1);
        const onClickHandler = (buttonType) => {
          if (buttonType === "previous" && page > 1) {
            setPage(page - 1);
            onPageChange(page - 1);
          } else {
            setPage(page + 1);
            onPageChange(page + 1);
          }
        };
        return <button onClick={() => onClickHandler("previous")}>prev</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("page");
  });

  // react-bench-2 anchor (fix-react-rdh-italia-design-react-kit-usenavscroll):
  // a debounce-wrapped closure runs after later renders, so the captured
  // `counter` goes stale exactly like a setTimeout closure.
  it("flags setCounter(counter + 1) inside a debounce-wrapped useCallback", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `const useNavScroll = (isActive) => {
        const [counter, setCounter] = useState(0);
        const registerActivity = useCallback(
          debounce(() => {
            setCounter(counter + 1);
          }, 100),
          [counter],
        );
        return { registerActivity };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("counter");
  });

  it("flags a spread setter inside a debounce wrapper (deferred execution)", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C({ draft }) {
        const [items, setItems] = useState([]);
        const save = debounce(() => setItems([...items, draft]), 300);
        return <button onClick={save}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a spread setter inside a throttle wrapper (deferred execution)", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C({ sample }) {
        const [points, setPoints] = useState([]);
        const record = throttle(() => setPoints([...points, sample]), 100);
        return <div onMouseMove={record}>{points.length}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // The spread shapes keep the deferred-context gate: a sync handler's arrow
  // is recreated every render and closes over fresh state, so the merge shape
  // is safe there.
  it("stays silent on a spread setter in a synchronous click handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C({ next }) {
        const [items, setItems] = useState([]);
        return <button onClick={() => setItems([...items, next])}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
