import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

interface LiteralJsonKeyCase {
  name: string;
  expression?: string;
  prefix?: string;
  code?: string;
  expected: number;
}

const literalJsonCases: LiteralJsonKeyCase[] = [
  {
    name: "Array prototype map replacement",
    prefix: "Array.prototype.map = replacement;",
    expression: `JSON.parse('["East"]').map((item, index) => <p key={index}>{item}</p>)`,
    expected: 1,
  },
  {
    name: "Array prototype map deletion",
    prefix: "delete Array.prototype.map;",
    expression: `JSON.parse('["East"]').map((item, index) => <p key={index}>{item}</p>)`,
    expected: 1,
  },
  {
    name: "Object redefines native map",
    prefix: 'Object.defineProperty(Array.prototype, "map", { value: replacement });',
    expression: `JSON.parse('["East"]').map((item, index) => <p key={index}>{item}</p>)`,
    expected: 1,
  },
  {
    name: "Reflect redefines native map",
    prefix: 'Reflect.defineProperty(Array.prototype, "map", { value: replacement });',
    expression: `JSON.parse('["East"]').map((item, index) => <p key={index}>{item}</p>)`,
    expected: 1,
  },
  {
    name: "unknown native Array namespace escape",
    prefix: "mutate(Array);",
    expression: `JSON.parse('["East"]').map((item, index) => <p key={index}>{item}</p>)`,
    expected: 1,
  },
  {
    name: "literal primitive p text",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 0,
  },
  {
    name: "literal primitive span text",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <span key={index}>{item}</span>)",
    expected: 0,
  },
  {
    name: "literal primitive li text",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <li key={index}>{item}</li>)",
    expected: 0,
  },
  {
    name: "whitespace around primitive child",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>\n  {item}\n</p>)",
    expected: 0,
  },
  {
    name: "empty and empty-rendering primitives",
    expression:
      "JSON.parse('[true,false,null,\"\"]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 0,
  },
  {
    name: "empty literal root array",
    expression: "JSON.parse('[]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 0,
  },
  {
    name: "distinct callback parameter names",
    expression:
      'JSON.parse(\'["North","South"]\').map((caption, position) => <p key={position}>{caption}</p>)',
    expected: 0,
  },
  {
    name: "two independent literal lists",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)}{JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 0,
  },
  {
    name: "unsafe sibling remains diagnosed",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)}{rows.map((row, index) => <input key={index} defaultValue={row.name} />)",
    expected: 1,
  },
  {
    name: "dynamic serialized prop",
    expression: "JSON.parse(serialized).map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "literal template source",
    expression: 'JSON.parse(`["East"]`).map((item, index) => <p key={index}>{item}</p>)',
    expected: 1,
  },
  {
    name: "literal object entries",
    expression: "JSON.parse('[{}]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "literal nested arrays",
    expression: "JSON.parse('[[\"East\"]]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "literal nonarray root",
    expression: "JSON.parse('\"East\"').map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "malformed literal JSON",
    expression: "JSON.parse('[\"East\",]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "reviver argument",
    expression:
      "JSON.parse('[\"East\",7,false,null]', reviver).map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "explicit undefined reviver",
    expression:
      "JSON.parse('[\"East\",7,false,null]', undefined).map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "computed parse property",
    expression: 'JSON["parse"](\'["East"]\').map((item, index) => <p key={index}>{item}</p>)',
    expected: 1,
  },
  {
    name: "optional parse property",
    expression: "JSON?.parse('[\"East\"]').map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "computed map property",
    expression:
      'JSON.parse(\'["East",7,false,null]\')["map"]((item, index) => <p key={index}>{item}</p>)',
    expected: 1,
  },
  {
    name: "optional map call",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map?.((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "filtered parsed array",
    expression:
      "JSON.parse('[\"East\",7,false,null]').filter(Boolean).map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "callback block body",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => { return <p key={index}>{item}</p>; })",
    expected: 1,
  },
  {
    name: "async callback",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map(async (item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "third array parameter",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index, array) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "callback arguments access",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{arguments[0]}</p>)",
    expected: 0,
  },
  {
    name: "map this argument",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>, props)",
    expected: 1,
  },
  {
    name: "annotated callback parameter",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item: string, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "coerced text child",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{String(item)}</p>)",
    expected: 1,
  },
  {
    name: "coerced key",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={String(index)}>{item}</p>)",
    expected: 1,
  },
  {
    name: "cast key",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index as number}>{item}</p>)",
    expected: 1,
  },
  {
    name: "custom output component",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <Caption key={index}>{item}</Caption>)",
    expected: 1,
  },
  {
    name: "function callback",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map(function (item, index) { return <p key={index}>{item}</p>; })",
    expected: 1,
  },
  {
    name: "output passed to unknown helper",
    expression:
      "handler(JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>))",
    expected: 1,
  },
  {
    name: "ref identity",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index} ref={remember}>{item}</p>)",
    expected: 1,
  },
  {
    name: "event identity",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index} onClick={handler}>{item}</p>)",
    expected: 1,
  },
  {
    name: "editable DOM",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index} contentEditable>{item}</p>)",
    expected: 1,
  },
  {
    name: "opaque props",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index} {...props}>{item}</p>)",
    expected: 1,
  },
  {
    name: "style projection",
    expression:
      'JSON.parse(\'["East",7,false,null]\').map((item, index) => <p key={index} style={{ color: "red" }}>{item}</p>)',
    expected: 1,
  },
  {
    name: "literal class attribute",
    expression:
      'JSON.parse(\'["East",7,false,null]\').map((item, index) => <p key={index} className="caption">{item}</p>)',
    expected: 1,
  },
  {
    name: "extra index child",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{index + 1}. {item}</p>)",
    expected: 1,
  },
  {
    name: "nested leaf child",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}><span>{item}</span></p>)",
    expected: 1,
  },
  {
    name: "nonselected native tag",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <div key={index}>{item}</div>)",
    expected: 1,
  },
  {
    name: "local parsed binding",
    expression: "rows.map((item, index) => <p key={index}>{item}</p>)",
    expected: 1,
  },
  {
    name: "shadowed JSON namespace",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'const JSON = { parse: () => ["East"] };',
    expected: 1,
  },
  {
    name: "reassigned JSON namespace",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "JSON = replacement;",
    expected: 1,
  },
  {
    name: "replaced parse method",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "JSON.parse = replacement;",
    expected: 1,
  },
  {
    name: "unknown JSON namespace escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "mutate(JSON);",
    expected: 1,
  },
  {
    name: "JSON namespace alias escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const namespace = JSON; mutate(namespace);",
    expected: 1,
  },
  {
    name: "parse method alias escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const parser = JSON.parse; mutate(parser);",
    expected: 1,
  },
  {
    name: "Array namespace alias escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const constructorAlias = Array; mutate(constructorAlias);",
    expected: 1,
  },
  {
    name: "Array prototype alias escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const prototypeAlias = Array.prototype; mutate(prototypeAlias);",
    expected: 1,
  },
  {
    name: "Object redefinition",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'Object.defineProperty(JSON, "parse", { value: replacement });',
    expected: 1,
  },
  {
    name: "Reflect redefinition",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'Reflect.defineProperty(JSON, "parse", { value: replacement });',
    expected: 1,
  },
  {
    name: "delete parse method",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "delete JSON.parse;",
    expected: 1,
  },
  {
    name: "dynamic namespace write",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "JSON[method] = replacement;",
    expected: 1,
  },
  {
    name: "global host alias escape",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const host = globalThis; mutate(host);",
    expected: 1,
  },
  {
    name: "global host namespace alias",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const { JSON: namespace } = window; mutate(namespace);",
    expected: 1,
  },
  {
    name: "future nested parse mutation",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "const later = () => { JSON.parse = replacement; };",
    expected: 1,
  },
  {
    name: "computed prototype recovery",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'const prototypeAlias = []["__proto__"]; mutate(prototypeAlias);',
    expected: 1,
  },
  {
    name: "literal constructor destructuring",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'const { "constructor": constructorAlias } = []; mutate(constructorAlias);',
    expected: 1,
  },
  {
    name: "legacy prototype getter recovery",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix:
      'const prototypeAlias = [].__lookupGetter__("__proto__").call([]); mutate(prototypeAlias);',
    expected: 1,
  },
  {
    name: "unknown ambient operation",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: 'console.log("ready");',
    expected: 1,
  },
  {
    name: "dynamic code execution",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}</p>)",
    prefix: "eval(source);",
    expected: 1,
  },
  {
    name: "existing inline member carveout stays unchanged",
    expression:
      'JSON.parse(\'[{"label":"East"}]\').map((item, index) => <span key={index} ref={remember}>{item.label}</span>)',
    expected: 0,
  },
  {
    name: "arguments alongside item child",
    expression:
      "JSON.parse('[\"East\",7,false,null]').map((item, index) => <p key={index}>{item}{arguments[0]}</p>)",
    expected: 1,
  },
  {
    name: "custom parent output",
    code: "const App = () => <Container>{JSON.parse('[\"East\"]').map((item, index) => <p key={index}>{item}</p>)}</Container>;",
    expected: 1,
  },
  {
    name: "default callback parameter",
    code: 'const App = () => <div>{JSON.parse(\'["East"]\').map((item = "fallback", index) => <p key={index}>{item}</p>)}</div>;',
    expected: 1,
  },
  {
    name: "optional callback parameter",
    code: "const App = () => <div>{JSON.parse('[\"East\"]').map((item?, index?) => <p key={index}>{item}</p>)}</div>;",
    expected: 1,
  },
  {
    name: "generic callback signature",
    code: "const App = () => <div>{JSON.parse('[\"East\"]').map(<Value,>(item, index) => <p key={index}>{item}</p>)}</div>;",
    expected: 1,
  },
];

describe("no-array-index-as-key literal JSON text leaves", () => {
  it.each(literalJsonCases)("$name", ({ code, expression, prefix, expected }) => {
    const source =
      code ??
      `const App = ({ rows, serialized, remember, handler, props, reviver, mutate, replacement, method, source }) => {
      ${prefix ?? ""}
      return <div>{${expression}}</div>;
    };`;
    const result = runRule(noArrayIndexAsKey, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
