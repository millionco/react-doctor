import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers", () => {
  it("flags state that is only set in a handler and never shown", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function App() {
        const [logged, setLogged] = useState(false);
        const onClick = () => setLogged(true);
        return <button onClick={onClick}>go</button>;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  it("does not flag state read in a side-effect-only effect's dependency array", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function DraftEditor() {
        const [dirty, setDirty] = useState(false);
        const onChange = () => setDirty(true);
        useEffect(() => {
          if (!dirty) return;
          const id = setTimeout(() => saveDraft(), 1000);
          return () => clearTimeout(id);
        }, [dirty]);
        return <textarea onChange={onChange} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag state used only as an effect re-run trigger (in deps, never read by the effect)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function DraftEditor() {
        const [saveRequestId, setSaveRequestId] = useState(0);
        const onChange = () => setSaveRequestId((requestId) => requestId + 1);
        useEffect(() => {
          const id = setTimeout(() => saveDraft(), 1000);
          return () => clearTimeout(id);
        }, [saveRequestId]);
        return <textarea onChange={onChange} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag state read by an effect that lists it in deps (the re-render drives the effect)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function DraftEditor() {
        const [dirty, setDirty] = useState(false);
        const onChange = () => setDirty(true);
        useEffect(() => {
          reportDraftState(dirty);
        }, [dirty]);
        return <textarea onChange={onChange} />;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags state that a dep-listing effect synchronously writes back (self-echo loop)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function Widget({ value }) {
        const [copied, setCopied] = useState(value);
        useEffect(() => {
          if (copied !== value) setCopied(value);
        }, [copied, value]);
        return <button onClick={() => setCopied(null)}>reset</button>;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("copied");
  });

  it("does not flag a guard-only effect dep when a same-named local shadows it elsewhere in the effect", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function BulkSubmitter({ items }) {
        const [dirty, setDirty] = useState(false);
        useEffect(() => {
          if (!dirty) return;
          items.forEach((dirty) => submitRow(dirty));
        }, [dirty, items]);
        return <button onClick={() => setDirty(true)}>save</button>;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an effect dep whose only same-named reads resolve to a shadowing local", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function Tracker() {
        const [ping, setPing] = useState(0);
        useEffect(() => {
          const ping = createBeacon();
          if (!ping) return;
          ping.send();
        }, [ping]);
        return <button onClick={() => setPing((count) => count + 1)}>ping</button>;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a payload-read effect dep even when a nested helper shadows its name", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `
      function Logger() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          reportCount(count);
          const normalize = (count) => count + 1;
          registerNormalizer(normalize);
        }, [count]);
        return <button onClick={() => setCount((value) => value + 1)}>+1</button>;
      }
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
