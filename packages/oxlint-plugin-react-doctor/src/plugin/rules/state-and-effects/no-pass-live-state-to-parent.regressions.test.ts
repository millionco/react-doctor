import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

describe("no-pass-live-state-to-parent — regressions", () => {
  it("still flags props.search(state) — a parent callback named like String.prototype.search", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = (props) => {
        const [results, setResults] = useState([]);
        useEffect(() => {
          props.search(results);
        }, [props, results]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a string read from a prop value (text.search)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const Child = ({ text }) => {
        const [pattern] = useState("needle");
        useEffect(() => {
          if (text.search(pattern) >= 0) console.log("found");
        }, [text, pattern]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the prop is a pure transform consumed locally", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ format }) {
        const [amount] = useState(0);
        const [display, setDisplay] = useState("");
        useEffect(() => { setDisplay(format(amount)); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a discarded prop callback that hands state to the parent", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ onSync }) {
        const [amount, setAmount] = useState(0);
        useEffect(() => { onSync(amount); }, [amount]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a concise-arrow effect body handing state up", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Price({ onSync }) {
        const [amount, setAmount] = useState(0);
        useEffect(() => onSync(amount), [amount]);
        return <button onClick={() => setAmount(1)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a logically guarded hand-back (onSubmit && onSubmit(values))", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Form({ onSubmit }) {
        const [values, setValues] = useState({});
        useEffect(() => { onSubmit && onSubmit(values); }, [values]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a useCallback-wrapped prop callback (bench: next-themes shape)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        const notify = useCallback((next) => onChange(next), [onChange]);
        useEffect(() => { notify(value); }, [value, notify]);
        return <input onChange={(event) => setValue(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a useEventCallback-wrapped prop callback (bench: react-colorful shape)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `const useEventCallback = (handler) => useCallback((value) => handler(value), [handler]);
      function useColorManipulation({ color, onChange }) {
        const [hsva, updateHsva] = useState(color);
        const onChangeCallback = useEventCallback(onChange);
        useEffect(() => {
          onChangeCallback(hsva);
        }, [hsva]);
        return [hsva, updateHsva];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags state driven by a frame-callback subscription (bench: victory-animation)", () => {
    const result = runRule(
      noPassLiveStateToParent,
      `function Animation({ onEnd }) {
        const [frame, setFrame] = useState(null);
        useEffect(() => {
          const subscription = timer.subscribe((data) => setFrame(data));
          return () => subscription.unsubscribe();
        }, []);
        useEffect(() => {
          if (frame) onEnd(frame);
        }, [frame]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
