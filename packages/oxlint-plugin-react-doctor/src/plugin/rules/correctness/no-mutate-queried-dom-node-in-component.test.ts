import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutateQueriedDomNodeInComponent } from "./no-mutate-queried-dom-node-in-component.js";

describe("no-mutate-queried-dom-node-in-component", () => {
  it("flags classList.add on a queried, component-owned class", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        useEffect(() => {
          document.querySelector('.panel').classList.add('open');
        }, []);
        return <div className="panel" />;
      }`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a style mutation on a getElementById result bound to a var", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Overlay() {
        const el = document.getElementById('main-content');
        el.style.filter = 'blur(3px)';
        return <section id="main-content" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags classList.remove on a queried #id owned by the component", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Menu() {
        const container = document.querySelector('#right');
        container.classList.remove('noscroll');
        return <aside id="right" className="noscroll" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained getElementById style mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row() {
        document.getElementById('row-1').style.zIndex = '1';
        return <div id="row-1" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutating a createElement node", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Download() {
        const a = document.createElement('a');
        a.style.display = 'none';
        return <div className="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setAttribute (not in the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.panel').setAttribute('data-x', '1');
        return <div className="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read-only query call", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.getElementById('panel').scrollIntoView();
        return <div id="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag document.body style mutations", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.body.style.overflow = 'hidden';
        return <div className="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ref.current style mutation", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const ref = useRef(null);
        ref.current.style.color = 'red';
        return <div ref={ref} className="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a selector the component does not render (no ownership link)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        document.querySelector('.external-widget').classList.add('open');
        return <div className="panel" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag innerHTML (dropped from the mutation set)", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Panel() {
        const el = document.getElementById('x');
        el.innerHTML = html;
        return <div id="x" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic (non-static) query id", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function Row({ rowId }) {
        document.getElementById(rowId).style.zIndex = '1';
        return <div id="row-1" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag mutations outside a component or hook", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function setup() {
        document.querySelector('.panel').classList.add('open');
      }
      const markup = <div className="panel" />;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the excluded #root token even when rendered", () => {
    const result = runRule(
      noMutateQueriedDomNodeInComponent,
      `function App() {
        document.getElementById('root').style.overflow = 'hidden';
        return <div id="root" />;
      }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
