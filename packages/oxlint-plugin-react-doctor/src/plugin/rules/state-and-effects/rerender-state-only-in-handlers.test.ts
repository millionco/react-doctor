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

  it("flags state echoed in an effect dep array when the effect also reads it", () => {
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

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("dirty");
  });
});
