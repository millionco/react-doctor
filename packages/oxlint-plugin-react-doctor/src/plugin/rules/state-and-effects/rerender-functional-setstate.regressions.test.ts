import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

// A deferral gate hoisted in front of the arithmetic / update shape checks
// (split/state PR #990) silenced both mined bugs below; these regressions
// pin that the shape checks stay
// reachable for synchronous handlers and that debounce/throttle wrappers
// count as deferred execution.

describe("rerender-functional-setstate — must-detect regressions", () => {
  // innovaccer/design-system Pagination: guarded prev/next
  // arithmetic in a plain synchronous click handler.
  it("flags setPage(page - 1) arithmetic in a synchronous click handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `export const Pagination = (props) => {
        const [page, setPage] = React.useState(props.page);
        const onClickHandler = (buttonType) => {
          switch (buttonType) {
            case 'prev':
              if (page > 1) setPage(page - 1);
              break;
            case 'next':
              if (page < props.totalPages) setPage(page + 1);
              break;
          }
        };
        return <button onClick={() => onClickHandler('prev')} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  // italia/design-react-kit useNavScroll: the setter closure is
  // wrapped in debounce(), so it runs after a delay and reads a stale counter.
  it("flags setCounter(counter + 1) inside useCallback(debounce(...))", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `export function useNavScroll() {
        const [counter, setCounter] = useState(0);
        const refresh = useCallback(
          debounce(() => {
            setCounter(counter + 1);
          }, 50),
          [counter],
        );
        return refresh;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a spread setter inside a debounce callback", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function SearchBox() {
        const [queries, setQueries] = useState([]);
        const remember = debounce((query) => {
          setQueries([...queries, query]);
        }, 300);
        return <input onChange={(event) => remember(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a spread setter inside a throttle callback", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Tracker() {
        const [points, setPoints] = useState([]);
        const record = throttle((point) => {
          setPoints([...points, point]);
        }, 100);
        return <div onPointerMove={(event) => record(event)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("rerender-functional-setstate — FP-fix cases stay silent", () => {
  it("stays silent on the functional-updater form", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `export const Pagination = (props) => {
        const [page, setPage] = React.useState(props.page);
        return <button onClick={() => setPage((previousPage) => previousPage - 1)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a spread setter in a synchronous inline handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Profile() {
        const [user, setUser] = useState({ active: false });
        return <button onClick={() => setUser({ ...user, active: true })} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays silent on a spread setter in a memoized synchronous handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Profile() {
        const [user, setUser] = useState({ name: "" });
        const onRename = useCallback((name) => setUser({ ...user, name }), [user]);
        return <button onClick={() => onRename("next")} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});

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

  // innovaccer/design-system Pagination:
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

  // italia/design-react-kit useNavScroll:
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

  // innovaccer/design-system Select: a spread setter in a MOUNT-ONLY effect
  // runs once right after the first render — state cannot have changed
  // between render and effect, so no staleness exists.
  it("stays silent on a spread setter inside a mount-only effect", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Select({ popoverWidth, trigger }) {
        const [popoverStyle, setPopoverStyle] = useState({});
        const triggerRef = useRef(null);
        useEffect(() => {
          const triggerWidth = triggerRef.current?.clientWidth;
          if (!popoverWidth && triggerWidth) {
            setPopoverStyle({ ...popoverStyle, width: triggerWidth });
          }
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a setter inside a subscription registered in a mount-only effect", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function C() {
        const [messages, setMessages] = useState([]);
        useEffect(() => {
          return subscribe((received) => setMessages([...messages, received]));
        }, []);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // cloudscape wizard page: a lone arithmetic setter per sync click handler
  // gets a fresh render between discrete clicks — no update can be lost.
  it("stays silent on a single arithmetic setter per synchronous click handler", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function WizardPage({ steps }) {
        const [activeStepIndex, setActiveStepIndex] = useState(0);
        const onNext = () => {
          if (activeStepIndex >= steps.length) return;
          setActiveStepIndex(activeStepIndex + 1);
        };
        const onPrevious = () => {
          if (activeStepIndex <= 0) return;
          setActiveStepIndex(activeStepIndex - 1);
        };
        return <button onClick={onNext} onBlur={onPrevious} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // atomantic/PortOS usePostSession: arithmetic in a useCallback whose deps
  // include the state fires on discrete user answers — never stale.
  it("stays silent on a lone arithmetic setter in a dep-tracked useCallback", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function usePostSession(currentDrill) {
        const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
        const submitAnswer = useCallback(() => {
          if (currentQuestionIndex + 1 >= currentDrill.questions.length) return;
          setCurrentQuestionIndex(currentQuestionIndex + 1);
        }, [currentDrill, currentQuestionIndex]);
        return { submitAnswer };
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags arithmetic when the same handler calls the setter twice", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Stepper() {
        const [count, setCount] = useState(0);
        const onDoubleStep = () => {
          setCount(count + 1);
          setCount(count + 1);
        };
        return <button onClick={onDoubleStep}>{count}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags arithmetic inside a setInterval closure", () => {
    const result = runRule(
      rerenderFunctionalSetstate,
      `function Timer() {
        const [seconds, setSeconds] = useState(0);
        useEffect(() => {
          const id = setInterval(() => setSeconds(seconds + 1), 1000);
          return () => clearInterval(id);
        }, []);
        return <span>{seconds}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
