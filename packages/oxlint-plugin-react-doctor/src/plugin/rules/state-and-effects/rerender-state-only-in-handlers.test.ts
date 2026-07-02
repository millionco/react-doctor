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
});
