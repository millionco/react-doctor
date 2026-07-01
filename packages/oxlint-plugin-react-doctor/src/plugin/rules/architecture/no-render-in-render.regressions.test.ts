import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRenderInRender } from "./no-render-in-render.js";

const run = (code: string) => runRule(noRenderInRender, code, { filename: "fixture.tsx" });

describe("architecture/no-render-in-render — regressions", () => {
  it("flags a locally-declared render* helper called inline", () => {
    const result = run(`const Foo = () => <div>{renderRow()}</div>;`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a props.render* render-prop invocation", () => {
    const result = run(`const Foo = (props) => <div>{props.renderProject(project)}</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a this.props.render* render-prop invocation", () => {
    const result = run(`const Foo = () => <div>{this.props.renderPanel()}</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a render prop destructured from props", () => {
    const result = run(
      `function List(props){ const { renderItem } = props; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a render prop destructured directly in the parameter list", () => {
    const result = run(`function List({ renderItem }){ return <div>{renderItem(1)}</div>; }`);
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot: the parameter carve-out is for COMPONENT props. A render* param
  // of an ordinary nested helper is a plain local, so an inline call still
  // remounts and must stay flagged.
  it("still flags a render* param of a nested non-component helper", () => {
    const result = run(
      `const Foo = () => { const runRow = (renderRow) => <li>{renderRow()}</li>; return <ul>{runRow((x) => x)}</ul>; };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: a render prop invoked directly on a nested prop bag roots in the
  // parent-owned props, so it's exempt — matching its destructured form.
  it("does not flag a render prop invoked on a nested prop bag (props.slots.renderItem())", () => {
    const result = run(`const Foo = (props) => <div>{props.slots.renderItem(1)}</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot wave 4: a render prop destructured from a nested prop bag
  // (`props.slots`) still roots in the parent-owned props, so it's exempt —
  // the comment documented this but the code only matched `this.props`.
  it("does not flag a render prop destructured from a nested prop bag", () => {
    const result = run(
      `function List(props){ const { renderItem } = props.slots; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a render prop destructured from this.props.slots", () => {
    const result = run(
      `function List(){ const { renderItem } = this.props.slots; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a render prop destructured from a non-prop object", () => {
    const result = run(
      `function List(){ const { renderItem } = config.slots; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a this.render* class-component helper method call", () => {
    const result = run(
      `class Chart extends React.Component {
        renderLine(props) { return <g>{props.x}</g>; }
        render() { return <g>{this.renderLine(this.props)}</g>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot: the render-prop exemption is only for `props` / `this.props`. An
  // unrelated object that happens to have a `.props` field must not hide a real
  // inline `render*` call.
  it("still flags an inline render* call on an arbitrary object's .props field", () => {
    const result = run(
      `function List(){ const renderRow = (x) => <li>{x}</li>; const cfg = { props: { renderRow } }; return <ul>{cfg.props.renderRow(1)}</ul>; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
