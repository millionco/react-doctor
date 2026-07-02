import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

// Must-detect anchors from react-bench-2. A deferral gate hoisted in front of
// the arithmetic / update shape checks (split/state PR #990) silenced both
// planted bugs below; these regressions pin that the shape checks stay
// reachable for synchronous handlers and that debounce/throttle wrappers
// count as deferred execution.

describe("rerender-functional-setstate — must-detect regressions", () => {
  // fix-react-rdh-innovaccer-design-system-pagination: guarded prev/next
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

  // fix-react-rdh-italia-design-react-kit-usenavscroll: the setter closure is
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
