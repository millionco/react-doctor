import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoUndef } from "./jsx-no-undef.js";

describe("react-builtins/jsx-no-undef regressions", () => {
  it("does not treat type-only declarations as runtime JSX bindings", () => {
    const result = runRule(
      jsxNoUndef,
      `
        interface Foo {}
        type Bar = {};
        const App = () => <><Foo /><Bar /></>;
      `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a JSX element that references a binding from a sibling function scope", () => {
    const result = runRule(
      jsxNoUndef,
      `
        function Outer() {
          const PrivateThing = () => null;
          return <PrivateThing />;
        }
        function Sibling() {
          // PrivateThing is in Outer's scope, NOT visible here.
          return <PrivateThing />;
        }
      `,
    );

    // Only the second usage should be flagged.
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a JSX element referencing a let/const declared in the same scope", () => {
    const result = runRule(
      jsxNoUndef,
      `
        function App() {
          const Local = () => null;
          return <Local />;
        }
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  // react-datepicker docs: react-live snippets are bare scripts ending in a
  // top-level `render(...)` whose components (`DatePicker`, `useState`, the
  // `render` itself) are injected into the runtime scope by LiveProvider.
  it("does not flag components in a react-live style script", () => {
    const result = runRule(
      jsxNoUndef,
      `
        const CustomCalendarContainer = () => {
          const [selectedDate, setSelectedDate] = useState(new Date());
          const MyContainer = ({ className, children }) => (
            <CalendarContainer className={className}>{children}</CalendarContainer>
          );
          return (
            <DatePicker
              selected={selectedDate}
              onChange={setSelectedDate}
              calendarContainer={MyContainer}
            />
          );
        };
        render(CustomCalendarContainer);
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag inline JSX passed to a bare top-level render call", () => {
    const result = runRule(jsxNoUndef, `render(<DatePicker />);`);

    expect(result.diagnostics).toEqual([]);
  });

  it("still flags undefined components when the file has module syntax", () => {
    const result = runRule(
      jsxNoUndef,
      `
        import { render } from "react-dom";
        render(<DatePicker />, document.body);
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags undefined components when render resolves to a local binding", () => {
    const result = runRule(
      jsxNoUndef,
      `
        var React;
        const render = (element) => React.render(element);
        render(<DatePicker />);
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags undefined components in scripts without a bare render call", () => {
    const result = runRule(jsxNoUndef, `var React; React.render(<App />);`);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a JSX element referencing a block-scoped binding from a sibling block", () => {
    const result = runRule(
      jsxNoUndef,
      `
        function App({ flag }) {
          if (flag) {
            const InsideIf = () => null;
            return <InsideIf />;
          }
          return <InsideIf />;
        }
      `,
    );

    // Block-scoped \`const InsideIf\` only exists inside the if-block;
    // the second usage at the function level should be flagged.
    expect(result.diagnostics).toHaveLength(1);
  });
});
