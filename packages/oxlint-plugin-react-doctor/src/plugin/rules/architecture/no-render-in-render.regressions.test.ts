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

  // Bugbot: the `props` carve-out must be scope-aware. A LOCAL object named
  // `props` is not the component's props bag, so an inline render* call on it
  // still remounts and stays flagged.
  it("still flags a render* call on a local object named props", () => {
    const result = run(
      `const Foo = () => { const props = { renderRow: (x) => <li>{x}</li> }; return <ul>{props.renderRow(1)}</ul>; };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  // fp-review PR 996: an earlier isStableMethodReceiver carve-out exempted
  // every this.renderX() call, voiding the react-datepicker calendar
  // must-detect check. Class fields (`renderX = () => …`) are per-instance,
  // so `this.` is not a stability signal — these must fire.
  it("flags a this.render* class-component helper method call", () => {
    const result = run(
      `class Chart extends React.Component {
        renderLine(props) { return <g>{props.x}</g>; }
        render() { return <g>{this.renderLine(this.props)}</g>; }
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags inline this.renderX() class-field calls (calendar.tsx mined shape)", () => {
    const result = run(
      `class Calendar extends Component {
        renderCurrentMonth = (date = this.state.date) => (
          <h2 className="react-datepicker__current-month">{date.toString()}</h2>
        );
        renderDefaultHeader = ({ monthDate }) => (
          <div className="react-datepicker__header">
            {this.renderCurrentMonth(monthDate)}
          </div>
        );
        render() {
          return <div>{this.renderAriaLiveRegion()}</div>;
        }
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a local const render* helper called inline", () => {
    const result = run(
      `const UploadFileItem = (props) => {
        const renderIcon = () => <div className="icon" />;
        return <div>{renderIcon()}</div>;
      };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review PR 996: the plain-alias spelling of a render prop is
  // semantically identical to the destructured one and must stay silent.
  it("does not flag a plain alias of a render prop (const renderItem = props.renderItem)", () => {
    const result = run(
      `function List(props){ const renderItem = props.renderItem; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a defaulted render-prop alias (props.renderItem ?? defaultRender)", () => {
    const result = run(
      `function List(props){ const renderItem = props.renderItem ?? defaultRender; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a conditional render-prop alias", () => {
    const result = run(
      `function List(props){ const renderItem = props.compact ? props.renderCompactItem : props.renderItem; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an alias of a parameter-destructured render prop", () => {
    const result = run(
      `function List({ renderItem }){ const renderRow = renderItem; return <div>{renderRow(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an alias of a local render* helper", () => {
    const result = run(
      `function List(){ const renderIcon = () => <i />; const renderItem = renderIcon; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
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

  it("does not flag a render prop called through a props-slice alias", () => {
    const result = run(
      `function List(props){ const slots = props.slots; return <div>{slots.renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a render prop called through a whole-props alias", () => {
    const result = run(
      `function List(props){ const p = props; return <div>{p.renderRow(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a member render* call whose alias roots in a local object", () => {
    const result = run(
      `function List(){ const renderRow = (x) => <li>{x}</li>; const local = { renderRow }; const slots = local; return <ul>{slots.renderRow(1)}</ul>; }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not claim a remount or state loss for a plain render-helper call", () => {
    const result = run(
      `function Page() {
        const renderHeader = () => <h1>Title</h1>;
        return <div>{renderHeader()}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("remount");
    expect(result.diagnostics[0].message).not.toContain("lose state");
    expect(result.diagnostics[0].message).toContain("renderHeader()");
  });
});
