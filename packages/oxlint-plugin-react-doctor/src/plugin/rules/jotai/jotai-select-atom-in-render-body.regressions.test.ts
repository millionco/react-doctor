import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jotaiSelectAtomInRenderBody } from "./jotai-select-atom-in-render-body.js";

describe("jotai/jotai-select-atom-in-render-body — regressions", () => {
  it("stays silent when selectAtom runs inside an event handler", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from 'jotai/utils'; const MyComp = () => { const handleClick = () => { const derived = selectAtom(baseAtom, (s) => s.value); store.set(derived, 1); }; return <button onClick={handleClick}>go</button>; };`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when selectAtom runs inside a useEffect callback", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from 'jotai/utils'; const MyComp = () => { useEffect(() => { const d = selectAtom(baseAtom, (s) => s.value); store.set(d, 1); }, []); return null; };`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("stays silent when selectAtom is wrapped in a namespaced React.useMemo", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils"; function Comp() { const derived = React.useMemo(() => selectAtom(baseAtom, (s) => s.value), []); return null; }`,
    );
    expect(diagnostics).toHaveLength(0);
  });

  it("still flags selectAtom called directly in the component body", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from 'jotai/utils'; const MyComp = () => { const d = selectAtom(baseAtom, (s) => s.value); return useAtomValue(d); };`,
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a handler bound to an idiomatic name is wired via onClick", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils"; function Component() { const pick = () => selectAtom(base, (s) => s.user); return <button onClick={pick}>x</button>; }`,
      { filename: "c.tsx" },
    );
    expect(diagnostics).toHaveLength(0);
  });
});
