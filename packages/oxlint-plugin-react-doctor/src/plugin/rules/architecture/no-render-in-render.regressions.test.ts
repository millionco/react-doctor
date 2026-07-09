import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRenderInRender } from "./no-render-in-render.js";

const run = (code: string) => runRule(noRenderInRender, code, { filename: "fixture.tsx" });

// Precision audit: the rule requires React-component semantics — the
// resolved helper's body must CALL hooks — before firing. A hook-free
// render helper is a plain function returning JSX (inline call ==
// inline JSX; nothing to lose), and `this.renderX()` method calls can't
// resolve to hook-calling locals, so both are exempt. A class
// component's render() is still render context: a bare hook-calling
// helper invoked there fires.
describe("architecture/no-render-in-render — regressions", () => {
  it("flags a component-local render* helper that calls hooks", () => {
    const result = run(
      `const Foo = () => {
        const renderRow = () => {
          const [open] = useState(false);
          return <div>{String(open)}</div>;
        };
        return <div>{renderRow()}</div>;
      };`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a module-scope render helper that calls hooks", () => {
    const result = run(
      `const renderStatus = () => {
        const [open] = useState(false);
        return <div>{String(open)}</div>;
      };
      export function Panel() {
        return <div>{renderStatus()}</div>;
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a hook-calling render helper declared as a function declaration", () => {
    const result = run(
      `function renderBadge(label) {
        const theme = useContext(ThemeContext);
        return <span className={theme}>{label}</span>;
      }
      export function Panel() {
        return <div>{renderBadge("new")}</div>;
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("renderBadge()");
  });

  it("does not claim a remount or state loss in the message", () => {
    const result = run(
      `function Page() {
        const renderHeader = () => {
          const [pinned] = useState(false);
          return <h1>{String(pinned)}</h1>;
        };
        return <div>{renderHeader()}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("remount");
    expect(result.diagnostics[0].message).not.toContain("lose state");
    expect(result.diagnostics[0].message).toContain("renderHeader()");
  });

  it("does not flag a hook-free render helper that merely returns JSX", () => {
    const result = run(
      `const UploadFileItem = (props) => {
        const renderIcon = () => <div className="icon" />;
        return <div>{renderIcon()}</div>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a module-scope hook-free formatter called inside a component", () => {
    const result = run(
      `function renderMessage(message) {
        if (!message) return null;
        return message.split("**").map((seg, i) =>
          i % 2 === 1 ? <strong key={i}>{seg}</strong> : <React.Fragment key={i}>{seg}</React.Fragment>,
        );
      }
      export function PluginDialogHost({ current }) {
        return <p>{renderMessage(current.message)}</p>;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a hook-calling helper invoked as a bare identifier inside a class render()", () => {
    const result = run(
      `const renderStatus = () => {
        const [open] = useState(false);
        return <div>{String(open)}</div>;
      };
      class Panel extends React.Component {
        render() { return <div>{renderStatus()}</div>; }
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("renderStatus()");
  });

  it("flags a hook-calling helper declared inside a class render() body", () => {
    const result = run(
      `class Panel extends Component {
        render() {
          const renderRow = () => {
            const [open] = useState(false);
            return <div>{String(open)}</div>;
          };
          return <div>{renderRow()}</div>;
        }
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("renderRow()");
  });

  it("does not flag a hook-free bare helper called inside a class render()", () => {
    const result = run(
      `const renderIcon = () => <span className="icon" />;
      class Panel extends React.Component {
        render() { return <div>{renderIcon()}</div>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a hook-calling helper called inside a non-React class method", () => {
    const result = run(
      `const renderStatus = () => {
        const [open] = useState(false);
        return <div>{String(open)}</div>;
      };
      class TemplateBuilder {
        build() { return <div>{renderStatus()}</div>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag class-component render helper methods (this.renderX())", () => {
    const result = run(
      `class Chart extends React.Component {
        renderLine(props) { return <g>{props.x}</g>; }
        render() { return <g>{this.renderLine(this.props)}</g>; }
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag class-field render helpers (react-datepicker calendar shape)", () => {
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
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a props.render* render-prop invocation", () => {
    const result = run(`const Foo = (props) => <div>{props.renderProject(project)}</div>;`);
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

  it("does not flag a plain alias of a render prop (const renderItem = props.renderItem)", () => {
    const result = run(
      `function List(props){ const renderItem = props.renderItem; return <div>{renderItem(1)}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an unresolved bare render* call", () => {
    const result = run(`const Foo = () => <div>{renderRow()}</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a hook-free helper that defines a nested hook-calling component", () => {
    const result = run(
      `const renderList = (items) => {
        const Row = ({ item }) => {
          const [open, setOpen] = useState(false);
          return <li onClick={() => setOpen(!open)}>{item.name}</li>;
        };
        return <ul>{items.map((item) => <Row key={item.id} item={item} />)}</ul>;
      };
      export function Panel({ items }) {
        return <div>{renderList(items)}</div>;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when a nested NON-component closure calls hooks during the helper call", () => {
    const result = run(
      `const renderRows = (items) => {
        const buildRow = (item) => {
          const theme = useContext(ThemeContext);
          return <li className={theme}>{item.name}</li>;
        };
        return <ul>{items.map(buildRow)}</ul>;
      };
      export function Panel({ items }) {
        return <div>{renderRows(items)}</div>;
      }`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("renderRows()");
  });

  it("does not flag a render* call inside a module-scope render helper (outside any component)", () => {
    const result = run(
      `const renderIcon = (icon) => {
        const theme = useContext(ThemeContext);
        return <span className={theme}>{icon}</span>;
      };
      export const renderDropdownMenuItems = (items) =>
        items.map((item) => <li key={item.key}>{renderIcon(item.icon)}</li>);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
