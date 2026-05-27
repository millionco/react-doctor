import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidValidateJsxNesting } from "./solid-validate-jsx-nesting.js";

describe("solid-validate-jsx-nesting", () => {
  it("flags div inside p", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <p><div>bad</div></p>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<p>");
    expect(result.diagnostics[0].message).toContain("block element");
  });

  it("allows span inside p", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <p><span>ok</span></p>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows text inside p", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <p>just text</p>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags div inside span", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <span><div>bad</div></span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<span>");
  });

  it("flags nested anchor inside anchor", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <a href="/"><a href="/inner">bad</a></a>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<a>");
    expect(result.diagnostics[0].message).toContain("nested inside itself");
  });

  it("flags button inside button", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <button><button>bad</button></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<button>");
  });

  it("flags anchor inside button", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <button><a href="/">bad</a></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("interactive");
  });

  it("flags input inside button", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <button><input type="text" /></button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<input>");
    expect(result.diagnostics[0].message).toContain("<button>");
  });

  it("flags non-li child of ul", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <ul><div>bad</div></ul>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<ul>");
    expect(result.diagnostics[0].message).toContain("<li>");
  });

  it("allows li inside ul", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <ul><li>ok</li></ul>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows For (Solid control flow) inside ul", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <ul><For each={items()}>{(item) => <li>{item}</li>}</For></ul>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows Show (Solid control flow) inside ul", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <ul><Show when={visible()}><li>item</li></Show></ul>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags non-table-child of table", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <table><div>bad</div></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<table>");
  });

  it("allows thead inside table", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <table><thead><tr><th>ok</th></tr></thead></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags non-td-th child of tr", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <tr><div>bad</div></tr>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<tr>");
  });

  it("allows td inside tr", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <tr><td>ok</td></tr>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags h2 inside h1", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <h1><h2>bad</h2></h1>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<h2>");
    expect(result.diagnostics[0].message).toContain("<h1>");
    expect(result.diagnostics[0].message).toContain("headings");
  });

  it("allows anything inside div", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <div><p>ok</p><div>ok</div><span>ok</span><table><tr><td>ok</td></tr></table></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags label inside label", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <label><label>bad</label></label>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<label>");
    expect(result.diagnostics[0].message).toContain("nested inside itself");
  });

  it("flags non-option child of select", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <select><div>bad</div></select>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<div>");
    expect(result.diagnostics[0].message).toContain("<select>");
  });

  it("allows option inside select", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <select><option value="a">A</option></select>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags non-dt-dd child of dl", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <dl><span>bad</span></dl>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<span>");
    expect(result.diagnostics[0].message).toContain("<dl>");
  });

  it("allows dt and dd inside dl", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <dl><dt>term</dt><dd>def</dd></dl>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows nested valid structure", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => (
        <div>
          <ul>
            <li><span>item</span></li>
          </ul>
          <table>
            <tbody>
              <tr>
                <td>cell</td>
              </tr>
            </tbody>
          </table>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not check custom component children", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <MyList><div>ok — MyList is not a DOM element</div></MyList>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Show wrapping div inside p (Show is transparent)", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <p><Show when={visible()}><div>ok at this level</div></Show></p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags p inside p", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <p><p>bad</p></p>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("block element");
  });

  it("flags h1 inside span", () => {
    const result = runRule(solidValidateJsxNesting, `const App = () => <span><h1>bad</h1></span>;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<h1>");
    expect(result.diagnostics[0].message).toContain("<span>");
  });

  it("flags form inside form", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <form><form>bad</form></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("nested inside itself");
  });

  it("flags multiple invalid children", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <p><div>a</div><h2>b</h2></p>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags non-tr child of tbody", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <tbody><td>bad</td></tbody>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<td>");
    expect(result.diagnostics[0].message).toContain("<tbody>");
  });

  it("allows optgroup inside select", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <select><optgroup label="g"><option>a</option></optgroup></select>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag DOM child inside custom component child", () => {
    const result = runRule(
      solidValidateJsxNesting,
      `const App = () => <p><Custom><div>ok</div></Custom></p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
