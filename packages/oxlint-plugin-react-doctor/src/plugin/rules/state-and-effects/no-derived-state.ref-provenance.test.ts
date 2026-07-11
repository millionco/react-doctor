import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

describe("no-derived-state — ref value provenance", () => {
  it("detects prop-derived state copied through a ref", () => {
    const result = runRule(
      noDerivedState,
      `function Settings(props) {
        const incomingApiKeysRef = useRef(props.apiKeys);
        const [apiKeys, setApiKeys] = useState([]);
        useEffect(() => {
          incomingApiKeysRef.current = props.apiKeys;
        }, [props.apiKeys]);
        useEffect(() => {
          setApiKeys(incomingApiKeysRef.current);
        }, [props.apiKeys]);
        return apiKeys.length;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a bare ref",
      `const incomingRef = useRef();
       useEffect(() => { incomingRef.current = source; }, [source]);
       useEffect(() => { setValue(incomingRef.current); }, [source]);`,
    ],
    [
      "a single-assignment alias",
      `const incomingRef = useRef(source);
       useEffect(() => {
         let next;
         next = incomingRef.current;
         setValue(next);
       }, [source]);`,
    ],
  ])("detects prop-derived state copied through %s", (_scenario, body) => {
    const result = runRule(
      noDerivedState,
      `function Panel({ source }) {
        const [value, setValue] = useState(null);
        ${body}
        return value;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps compound ref assignments unknown", () => {
    const result = runRule(
      noDerivedState,
      `function Counter({ initialCount }) {
        const countRef = useRef(initialCount);
        const [count, setCount] = useState(0);
        useEffect(() => { countRef.current += 1; }, []);
        useEffect(() => { setCount(countRef.current); }, [initialCount]);
        return count;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps DOM and externally assigned refs out of render provenance", () => {
    const domResult = runRule(
      noDerivedState,
      `function Panel() {
        const elementRef = useRef(null);
        const [width, setWidth] = useState(0);
        useLayoutEffect(() => setWidth(elementRef.current.getBoundingClientRect().width), []);
        return <div ref={elementRef}>{width}</div>;
      }`,
    );
    const externalResult = runRule(
      noDerivedState,
      `function Panel({ source }) {
        const valueRef = useRef(source);
        const [value, setValue] = useState(0);
        useEffect(() => { valueRef.current = readExternalValue(); }, []);
        useEffect(() => setValue(valueRef.current), [source]);
        return value;
      }`,
    );
    expect(domResult.parseErrors).toEqual([]);
    expect(externalResult.parseErrors).toEqual([]);
    expect(domResult.diagnostics).toEqual([]);
    expect(externalResult.diagnostics).toEqual([]);
  });
});
