import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlineHocOnComponent } from "./no-inline-hoc-on-component.js";

describe("probe", () => {
  it("A: memo(observer(inline)) composition", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Header = memo(observer((props) => {
        return <h1>{props.store.title}</h1>;
      }));`,
    );
    expect(result.parseErrors).toEqual([]);
    console.log("A diagnostics:", result.diagnostics.length);
  });

  it("B: export default connect(mapState)(inline)", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export default connect(mapState)((props) => {
        return <div>{props.title}</div>;
      });`,
    );
    console.log("B diagnostics:", result.diagnostics.length);
  });

  it("C: returned config object with nested render callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Columns = defineColumns(() => {
        return [{ title: "Name", render: (row) => <a>{row.name}</a> }];
      });`,
    );
    console.log("C diagnostics:", result.diagnostics.length);
  });

  it("C2: arrow expression body returning config with nested render callback", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Theme = createTheme(() => ({ icon: () => <Icon /> }));`,
    );
    console.log("C2 diagnostics:", result.diagnostics.length);
  });

  it("D: result cast with as before binding", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Header = observer((props) => <h1>{props.title}</h1>) as React.FC<Props>;`,
    );
    console.log("D diagnostics:", result.diagnostics.length);
  });

  it("D2: inline function cast with as inside the call", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Header = observer(((props) => <h1>{props.title}</h1>) as React.FC<Props>);`,
    );
    console.log("D2 diagnostics:", result.diagnostics.length);
  });

  it("E: nested HOC composition connect(map)(withRouter(inline))", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `export const Page = connect(mapState)(withRouter((props) => {
        return <div>{props.location.pathname}</div>;
      }));`,
    );
    console.log("E diagnostics:", result.diagnostics.length);
  });

  it("F: named function expression keeps display name", () => {
    const result = runRule(
      noInlineHocOnComponent,
      `const Page = withRouter(function PageBase(props) {
        return <div>{props.location.pathname}</div>;
      });`,
    );
    console.log("F diagnostics:", result.diagnostics.length);
  });
});
