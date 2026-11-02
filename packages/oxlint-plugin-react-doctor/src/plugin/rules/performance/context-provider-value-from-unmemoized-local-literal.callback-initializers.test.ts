import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { contextProviderValueFromUnmemoizedLocalLiteral } from "./context-provider-value-from-unmemoized-local-literal.js";

describe("context provider callback body initializers", () => {
  it.each([
    ["a direct var initializer", "var render = () => null; return render();", 0],
    ["a bare var declaration", "var render; return render();", 1],
    ["an initializer after the returned call", "return render(); var render = () => null;", 1],
    ["a call in the initializer", "var render = render(); return render;", 1],
    [
      "an alias-preserving initializer",
      "const original = render; var render = original; return render();",
      1,
    ],
    [
      "the existing conservative guard after assignment restoration",
      "const original = render; var render = () => null; render = original; return render();",
      0,
    ],
    [
      "an incoming callback restored by initialization",
      "const original = render; var render = () => null; var render = original; return render();",
      1,
    ],
    [
      "an incoming callback restored by destructuring",
      "const original = render; var render = () => null; var [render] = [original]; return render();",
      1,
    ],
    [
      "the existing conservative guard after destructuring assignment restoration",
      "const original = render; var render = () => null; [render] = [original]; return render();",
      0,
    ],
    [
      "the existing conservative guard after object assignment restoration",
      "const original = render; var render = () => null; ({ render } = { render: original }); return render();",
      0,
    ],
    [
      "the existing conservative guard after a nested helper restoration",
      "const original = render; var render = () => null; function restore() { render = original; } restore(); return render();",
      0,
    ],
    [
      "the existing conservative guard after a loop restoration",
      "const original = render; var render = () => null; for (render of [original]) {} return render();",
      0,
    ],
    [
      "an incoming callback restored by a loop declaration",
      "const original = render; var render = () => null; for (var render of [original]) {} return render();",
      1,
    ],
    [
      "an incoming callback restored by a destructured loop declaration",
      "const original = render; var render = () => null; for (var { render } of [{ render: original }]) {} return render();",
      1,
    ],
    [
      "a property write on a replacement",
      "const original = render; var render = () => null; render.current = original; return render();",
      1,
    ],
    [
      "an uncalled nested restoration",
      "const original = render; var render = () => null; function restore() { render = original; } return render();",
      0,
    ],
    [
      "a replacement forwarding through an alias",
      "const original = render; var render = () => original(); return render();",
      1,
    ],
    [
      "a function expression forwarding through an alias",
      "const original = render; var render = function () { return original(); }; return render();",
      1,
    ],
    [
      "a replacement forwarding through arguments",
      "var render = () => arguments[0](); return render();",
      1,
    ],
    [
      "a getter forwarding through an alias",
      "const original = render; var render = () => ({ get value() { return original(); } }).value; return render();",
      1,
    ],
    [
      "a default parameter forwarding through an alias",
      "const original = render; var render = (value = original()) => value; return render();",
      1,
    ],
    [
      "an aliased sibling output",
      "const original = render; var render = () => null; return [original(), render()];",
      1,
    ],
    [
      "an arguments sibling output",
      "var render = () => null; return [arguments[0](), render()];",
      1,
    ],
    ["a self-preserving initializer", "var render = render; return render();", 1],
    ["a body function declaration", "function render() { return null; } return render();", 0],
    [
      "a hoisted body function declaration",
      "return render(); function render() { return null; }",
      0,
    ],
    [
      "a replacement before a bare redeclaration",
      "var render = () => null; var render; return render();",
      0,
    ],
    [
      "a nested function parameter",
      "function nested(render) { var render = () => null; } return render();",
      1,
    ],
    [
      "a function expression self name",
      "var unrelated = function render() { return null; }; return render();",
      1,
    ],
    [
      "a call before initialization in a comma expression",
      "var render = (null, render()); return render;",
      1,
    ],
    [
      "a named function expression initializer",
      "var render = function render() { return null; }; return render();",
      0,
    ],
    [
      "a preserved call result before initialization",
      "var result = render(), render = () => null; return result;",
      1,
    ],
    [
      "a later declarator after initialization",
      "var render = () => null, result = render(); return result;",
      0,
    ],
    [
      "a replacement after a bare redeclaration",
      "var render; var render = () => null; return render();",
      0,
    ],
    ["an unconditional block var initializer", "{ var render = () => null; } return render();", 0],
    [
      "a conditional var initializer",
      "if (enabled) { var render = () => null; } return render();",
      1,
    ],
    ["a loop var initializer", "while (enabled) { var render = () => null; } return render();", 1],
    [
      "an object binding preserving the callback",
      "var { render } = { render }; return render();",
      1,
    ],
    ["an array binding preserving the callback", "var [render] = [render]; return render();", 1],
    [
      "a binding default preserving a provided callback",
      "var [render = () => null] = [render]; return render();",
      1,
    ],
    [
      "an initializer reading the incoming callback",
      "var [render = render] = []; return render();",
      1,
    ],
    [
      "a block function with a separate binding",
      "{ function render() { return null; } } return render();",
      1,
    ],
    [
      "a separately declared replacement result",
      "var render = () => null; var result = render(); return result;",
      0,
    ],
    [
      "nested unconditional var blocks",
      "{ var render; { var render = () => null; } } var render; return render();",
      0,
    ],
    [
      "pure aliases captured by uncalled declarations",
      "const original = render, alias = original; var render = () => null; function restore() { render = alias; } return render();",
      0,
    ],
    [
      "an uncalled restoration after the result declaration",
      "const original = render; var render = () => null, result = render(); function restore() { render = original; } return result;",
      0,
    ],
    [
      "a bare result redeclaration",
      "var result, render = () => null, result = render(); var result; return result;",
      0,
    ],
    [
      "a forwarding replacement through a second alias",
      "const original = render, alias = original; var render = () => alias(); return render();",
      1,
    ],
    [
      "a callback restored from a second alias",
      "const original = render, alias = original; var render = () => null; var render = alias; return render();",
      1,
    ],
    [
      "a mutable forwarding alias",
      "let original = render; var render = () => original(); return render();",
      1,
    ],
    [
      "the preserved external guard after escaped restoration",
      "const original = render; var render = () => null; function restore() { render = original; } const restoreAlias = restore; restoreAlias(); return render();",
      0,
    ],
    [
      "a getter-derived forwarding alias",
      "const original = render; const alias = ({ get callback() { return original; } }).callback; var render = () => alias(); return render();",
      1,
    ],
    [
      "an original call in another declarator",
      "const original = render; var result = original(), render = () => null; return [result, render()];",
      1,
    ],
    [
      "callback argument evaluation and sibling output",
      "const original = render; var render = () => null; return [render(original()), original()];",
      1,
    ],
    [
      "a conditionally preserved initializer",
      "var render = enabled ? () => null : render; return render();",
      1,
    ],
    ["a same-name block binding", "{ const render = () => null; } return render();", 1],
    [
      "a result before an unconditional block replacement",
      "var result = render(); { var render = () => null; } return result;",
      1,
    ],
    [
      "a callback restored in an unconditional block",
      "const original = render; var render = () => null; { var render = original; } return render();",
      1,
    ],
    [
      "a returned original beside an inert result local",
      "const original = render; var render = () => null, result = render(); return [original(), result, render()];",
      1,
    ],
  ])("handles %s", (_name, helperBody, diagnosticCount) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       function renderNow(render) { ${helperBody} }
       function App() {
         return renderNow(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each([
    "const renderNow = function render(render) { return render(); };",
    "const renderNow = function renderNow(render) { var render; return render(); };",
    "function renderNow(render, another = null) { var render; return render(); }",
    "function renderNow(render, original = render) { function render() { return original(); } return render(); }",
    "function renderNow(render, original = render) { function render() { return original(); } var render; return render(); }",
    "function renderNow(render, original = render) { var render = () => original(); return render(); }",
  ])("preserves the parameter in %s", (helperDeclaration) => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       ${helperDeclaration}
       function App() {
         return renderNow(function Inner() {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         });
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves output rendered by an inherited property setter", () => {
    const result = runRule(
      contextProviderValueFromUnmemoizedLocalLiteral,
      `import { createContext } from "react";
       const ThemeContext = createContext(null);
       let renderedOutput;
       Object.defineProperty(Function.prototype, "current", {
         set(value) { renderedOutput = value(); }
       });
       function renderNow(render) {
         const original = render;
         var render = () => null;
         render.current = original;
         return render();
       }
       function App() {
         return [renderNow(() => {
           const value = {};
           return <ThemeContext.Provider value={value} />;
         }), renderedOutput];
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
