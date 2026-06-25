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

  it("does not flag JSX elements declared via /* global */ comments", () => {
    const code = `
/* global DatePicker, CalendarContainer */
const App = () => (
  <DatePicker>
    <CalendarContainer />
  </DatePicker>
);
`;
    const result = runRule(jsxNoUndef, code, {
      settings: { "jsx-no-undef-source-text": code },
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag JSX elements declared via single-identifier global comments", () => {
    const code = `
/* global MyComponent */
const App = () => <MyComponent />;
`;
    const result = runRule(jsxNoUndef, code, {
      settings: { "jsx-no-undef-source-text": code },
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("flags JSX elements not in global comments", () => {
    const code = `
/* global DatePicker */
const App = () => (
  <>
    <DatePicker />
    <CalendarContainer />
  </>
);
`;
    const result = runRule(jsxNoUndef, code, {
      settings: { "jsx-no-undef-source-text": code },
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("CalendarContainer");
  });

  it("handles line comments for globals", () => {
    const code = `
// global MyComponent
const App = () => <MyComponent />;
`;
    const result = runRule(jsxNoUndef, code, {
      settings: { "jsx-no-undef-source-text": code },
    });

    expect(result.diagnostics).toEqual([]);
  });

  it("handles multiple global comments", () => {
    const code = `
/* global Foo */
/* global Bar, Baz */
const App = () => (
  <>
    <Foo />
    <Bar />
    <Baz />
  </>
);
`;
    const result = runRule(jsxNoUndef, code, {
      settings: { "jsx-no-undef-source-text": code },
    });

    expect(result.diagnostics).toEqual([]);
  });
});
