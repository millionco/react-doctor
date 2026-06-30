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

  it("does not flag a this.render* class-component helper method call", () => {
    const result = run(
      `class Chart extends React.Component {
        renderLine(props) { return <g>{props.x}</g>; }
        render() { return <g>{this.renderLine(this.props)}</g>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
