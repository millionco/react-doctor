import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers unreachable declarations", () => {
  it.each(["return <main />;", "return;", 'throw new Error("Unavailable");'])(
    "ignores state declared after a direct exit: %s",
    (exitStatement) => {
      const result = runRule(
        rerenderStateOnlyInHandlers,
        `function Panel() {
          ${exitStatement}
          const [saved, setSaved] = useState(false);
          return <button onClick={() => setSaved(true)}>Save</button>;
        }`,
      );
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("ignores an arrow component's unreachable state", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const Panel = () => {
        return <main />;
        const [saved, setSaved] = useState(false);
        return <button onClick={() => setSaved(true)}>Save</button>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "if (hidden) return null;",
    "const readDefault = () => { return null; };",
    'try { throw new Error("Recovered"); } catch {}',
  ])("retains reachable handler-only state after %s", (precedingStatement) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel({ hidden }) {
        ${precedingStatement}
        const [saved, setSaved] = useState(false);
        return <button onClick={() => setSaved(true)}>Save</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains state declared before the component return", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [saved, setSaved] = useState(false);
        const save = () => setSaved(true);
        return <button onClick={save}>Save</button>;
        const [unused, setUnused] = useState(false);
        return <button onClick={() => setUnused(true)}>Unused</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"saved"');
  });
});
