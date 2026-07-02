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

  it("still flags selectAtom in a deps-less useEffect (runs after every render)", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils";
       function MyComponent({ base }) {
         const [derived, setDerived] = useState(null);
         useEffect(() => {
           setDerived(selectAtom(base, (s) => s.value));
         });
         return useAtomValue(derived ?? base);
       }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags a handle*-named helper INVOKED during render", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils";
       function MyComponent() {
         const handleSelection = () => selectAtom(baseAtom, (s) => s.foo);
         const sliceAtom = handleSelection();
         return useAtomValue(sliceAtom);
       }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags an on*-named arrow used as a render helper (not a handler)", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils";
       function MyComponent() {
         const onDerive = () => selectAtom(baseAtom, (s) => s.foo);
         const sliceAtom = onDerive();
         return useAtomValue(sliceAtom);
       }`,
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags a factory invoked inline in an onClick attribute (runs during render)", () => {
    const { diagnostics } = runRule(
      jotaiSelectAtomInRenderBody,
      `import { selectAtom } from "jotai/utils";
       function MyComponent() {
         const makeClickAtom = () => {
           const derived = selectAtom(baseAtom, (s) => s.value);
           return useAtomValue(derived);
         };
         return <button onClick={makeClickAtom()}>go</button>;
       }`,
    );
    expect(diagnostics).toHaveLength(1);
  });
});
