import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers — regressions", () => {
  it("stays silent when state drives an effect through a one-hop derived local", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Widget() {
        const [page, setPage] = useState(1);
        const offset = page * 10;
        useEffect(() => { fetchItems(offset); }, [offset]);
        return <button onClick={() => setPage((p) => p + 1)}>Next</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state is read during render by a hook call argument", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Chart() {
        const [scrollY, setScrollY] = useState(0);
        const onScroll = () => setScrollY(window.scrollY);
        useChartEngine(scrollY);
        return <div onScroll={onScroll} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags write-only state with no effect dependency", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function App() {
        const [logged, setLogged] = useState(false);
        const onClick = () => setLogged(true);
        return <button onClick={onClick}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });
});
