import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingUsetransitionLoading } from "./rendering-usetransition-loading.js";

describe("performance/rendering-usetransition-loading — regressions", () => {
  it("stays silent when the loading flag tracks a promise chain", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const load = () => { setIsLoading(true); loadData().then(() => setIsLoading(false)); }; return <button onClick={load}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous loading-flag toggle", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const toggle = () => { setIsLoading(true); }; return <button onClick={toggle}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FN-critical bench anchor (fix-react-rdh-algolia-react-instantsearch-useanswers):
  // the planted bug clears the flag only INDIRECTLY — the .then handler calls a
  // debounced wrapper that in turn calls the setter. The promise-chain guard
  // deliberately inspects only inline .then/.catch/.finally arguments for DIRECT
  // setter calls; following handler indirection would void the bench task.
  it("still flags the planted useAnswers shape: setter cleared via a debounce-indirected .then handler", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `
function useAnswers({ query }) {
  const [isLoading, setIsLoading] = useState(false);
  const [answers, setAnswers] = useState([]);
  const setDebouncedResult = useMemo(
    () =>
      debounce((result) => {
        setIsLoading(false);
        setAnswers(result.hits);
      }, 200),
    [],
  );
  useEffect(() => {
    setIsLoading(true);
    findAnswers(query).then((result) => {
      setDebouncedResult(result);
    });
  }, [query, setDebouncedResult]);
  return { isLoading, answers };
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a setter cleared via a named .then handler (handler reference, not inline)", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const handleResult = (result) => { setIsLoading(false); }; const load = () => { setIsLoading(true); loadData().then(handleResult); }; return <button onClick={load}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
