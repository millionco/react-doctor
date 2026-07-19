import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noObjectOrArrayCoercedToStringInTemplateLiteral } from "./no-object-or-array-coerced-to-string-in-template-literal.js";

describe("no-object-or-array-coerced-to-string-in-template-literal", () => {
  it("flags interpolating an identifier bound to an object literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${meta}`; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag interpolating an identifier bound to an array literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const sizes = [1, 2, 3]; return `sizes: ${sizes}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a useRef object interpolated bare", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function C() { const ref = useRef({ x: 0 }); return `ref: ${ref}`; }",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a useState value whose initializer is an array literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function C() { const [items] = useState([]); return `items: ${items}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags string + concatenation of an object literal", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      'function f() { const err = { code: 1 }; return "Error: " + err; }',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a member access on the interpolated value", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${meta.id}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array joined explicitly", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const sizes = [1, 2, 3]; return `sizes: ${sizes.join(',')}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.stringify", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const meta = { id: 1 }; return `meta: ${JSON.stringify(meta)}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a function parameter typed as an object", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f(err) { return `Error: ${err}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier bound to a string", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const name = 'ada'; return `name: ${name}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported/unresolved identifier", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { return `value: ${imported}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag numeric + arithmetic (no string sibling)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const data = [1]; return data + count; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reading a leaf property built into a template", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const source = { slack: { channel: { name: 'x' } } }; return `ch: ${source.slack.channel.name}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a bare object literal interpolated directly", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { return `obj: ${{ id: 1 }}`; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a bare array literal interpolated directly", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { return `pair: ${[1, 2]}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags arrays whose default coercion loses object or nested-array structure", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      'const users = [{ name: "Ada" }];\n' +
        'const rows = [["Ada", "admin"], ["Grace", "owner"]];\n' +
        "const labels = [`users: ${users}`, `rows: ${rows}`];",
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags statically lossy arrays introduced through literal spreads", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const objectRows = [{ id: 1 }];
       const labels = [
         \`direct: \${[...[{ id: 1 }]]}\`,
         \`bound: \${[...objectRows]}\`,
       ];`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag flat arrays introduced through literal spreads", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const values = [1, 2]; const label = \`values: \${[...values]}\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array interpolated into a styled-components tagged template", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "const flexStyles = ['display: flex;', 'align-items: center;']; const Row = styled.div`${flexStyles} color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array of templates interpolated into a lit-html tagged template", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function view() { const parts = [html`<li>a</li>`, html`<li>b</li>`]; return html`<ul>${parts}</ul>`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object literal that defines its own toString", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const point = { x: 1, y: 2, toString() { return this.x + ',' + this.y; } }; return `point: ${point}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object literal that defines [Symbol.toPrimitive]", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { const money = { amount: 5, [Symbol.toPrimitive]() { return '$5'; } }; return `cost: ${money}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object literal that spreads unknown properties", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f(base) { const merged = { ...base, id: 1 }; return `merged: ${merged}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the string-builder idiom (let array reassigned to a joined string)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { let lines = ['a', 'b']; lines = lines.join('\\n'); return `text: ${lines}`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a var array reassigned to a joined string before interpolation (Emscripten glue idiom)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function f() { var argsList = []; argsList = argsList.join(','); return `fn(${argsList})`; }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array comma-join inside rgb()", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "const accent = [250, 128, 114];\nconst style = `color: rgb(${accent})`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array comma-join inside matrix()", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "const matrixValues = [1, 0, 0, 1, 20, 30];\nel.style.transform = `matrix(${matrixValues})`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare interpolated array outside functional syntax", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "const items = [1, 2, 3];\nconst label = `items: ${items}`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag intentional D3 coordinate serialization", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const transform = (point) => \`translate(\${[point.x, point.y]})\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag intentional CSV header serialization", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const firstRow = ["time", "status", "logs"]; const csv = \`\${firstRow}\\r\\n\${body}\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in test files (URL-expectation interpolation)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "const serviceName = ['serviceName'];\nconst expected = `metrics/latencies?service=${serviceName}`;",
      { filename: "jaeger.test.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array comma-joined into an Error message (tRPC invalid-path shape)", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function resolve(options) { const path = [...options.path]; if (path.length !== 2) { throw new Error(`Invalid path ${path}`); } return path; }",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an object interpolated into an Error message", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      "function fail() { const details = { code: 1 }; throw new Error(`request failed: ${details}`); }",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed local useState helper", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const useState = () => ["safe"]; function C() { const [value] = useState({}); return \`${"${value}"}\`; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a directly concatenated object literal", () => {
    const result = runRule(noObjectOrArrayCoercedToStringInTemplateLiteral, `"value=" + {};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only flags object coercion with non-string addition operands", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const objectValue = 1 + { answer: 42 }; const arrayValue = [1, 2] + 3;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag array serialization in arbitrary function-looking text", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `const items = ["a", "b"]; const text = \`warning(\${items})\`;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an object literal with a computed static toString method", () => {
    const result = runRule(
      noObjectOrArrayCoercedToStringInTemplateLiteral,
      `function f() { const point = { x: 1, ["toString"]() { return String(this.x); } }; return \`point: ${"${point}"}\`; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
