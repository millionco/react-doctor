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
});
