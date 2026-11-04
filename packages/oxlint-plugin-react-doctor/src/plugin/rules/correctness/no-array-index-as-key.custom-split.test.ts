import { describe, expect, it } from "vite-plus/test";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../constants/thresholds.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const firstRecord = '<input name="alpha" data-record-id="alpha" defaultValue="a" />';
const secondRecord = '<input name="beta" data-record-id="beta" defaultValue="b" />';
const forwardRecords = `[${firstRecord}, ${secondRecord}]`;
const reversedRecords = `[${secondRecord}, ${firstRecord}]`;
const splitMethod = `[Symbol.split](text: string) { return text === "swap" ? ${reversedRecords} : ${forwardRecords}; }`;
const protocol = `{ ${splitMethod} }`;
const regexpProtocol = `Object.assign(/x/, ${protocol})`;
const splitExpression = (separator = regexpProtocol, receiver = "`${query}`"): string =>
  `${receiver}.split(${separator})`;
const renderExpression = (expression: string, mapper = "<b key={index}>{part}</b>"): string =>
  `${expression}.map((part, index) => ${mapper})`;
const renderSplit = (separator = regexpProtocol, receiver = "`${query}`"): string =>
  `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(separator, receiver))}}</>;`;

const expectDiagnostics = (source: string, count: number): void => {
  const result = runRule(noArrayIndexAsKey, source, { includeLocations: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("input-dependent custom split record reversal", () => {
  it.each([
    renderSplit(),
    renderSplit(protocol),
    renderSplit().replace("{ query: string }", "{ readonly query: string }"),
    `export const Highlight = ({ query }: { query: string }) => ${renderExpression(splitExpression())};`,
    `export const Highlight = ({ query }: { query: string }) => { return <>{${renderExpression(splitExpression())}}</>; };`,
    `export const Highlight = ({ query }: { query: string }) => <>  {${renderExpression(splitExpression())}}  </>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), '<b key={index} className="fragment">{part}</b>')}}</>;`,
    `const separator: RegExp = ${regexpProtocol}; ${renderSplit("separator")}`,
    `const separator = ${regexpProtocol}; const alias = separator; ${renderSplit("alias")}`,
    renderSplit(regexpProtocol.replaceAll('defaultValue="a"', 'defaultValue={"a"}')),
    renderSplit(regexpProtocol.replaceAll("<input ", '<input type="text" ')),
  ])("reports a closed reversal in an unconditional render: %s", (source) => {
    expectDiagnostics(source, 1);
  });

  it.each([
    renderSplit(regexpProtocol, '"initial"'),
    renderSplit(regexpProtocol, "query"),
    renderSplit(`{ [Symbol.split]() { return ${forwardRecords}; } }`),
    renderSplit(
      `{ [Symbol.split](text: string) { return text === "swap" ? ${forwardRecords} : ${forwardRecords}; } }`,
    ),
    renderSplit(
      '{ [Symbol.split](text: string) { return text === "swap" ? ["b", "a"] : ["a", "b"]; } }',
    ),
    renderSplit(protocol.replace('text === "swap"', 'query === "swap"')),
    renderSplit(protocol.replace('text === "swap"', 'text.includes("swap")')),
    renderSplit(protocol.replaceAll("defaultValue", "value")),
    renderSplit(protocol.replaceAll('name="alpha"', 'key="alpha" name="alpha"')),
    renderSplit(protocol.replaceAll('name="alpha"', 'ref={capture} name="alpha"')),
    renderSplit(protocol.replaceAll('name="alpha"', 'onChange={capture} name="alpha"')),
    renderSplit(protocol.replaceAll('name="alpha"', '{...properties} name="alpha"')),
    renderSplit(protocol.replaceAll('defaultValue="a"', "defaultValue={read()}")),
    renderSplit(
      protocol.replaceAll(
        'defaultValue="a"',
        'defaultValue={(() => { throw new Error("stop"); })()}',
      ),
    ),
    renderSplit(protocol.replaceAll(firstRecord, `<span>${firstRecord}</span>`)),
    renderSplit(protocol.replaceAll(firstRecord, "<Widget />")),
    renderSplit(
      protocol.replaceAll(firstRecord, firstRecord + ', (() => { throw new Error("stop"); })()'),
    ),
    renderSplit(protocol.replaceAll('data-record-id="alpha"', 'data-record-id="other"')),
    renderSplit(protocol.replaceAll('defaultValue="b"', 'defaultValue="a"')),
    renderSplit(
      protocol.replace("[Symbol.split](text: string)", "[Symbol.split](text = replace())"),
    ),
    renderSplit(
      protocol.replace("[Symbol.split](text: string)", "async [Symbol.split](text: string)"),
    ),
    renderSplit(protocol.replace("[Symbol.split](text: string)", "get [Symbol.split]()")),
    renderSplit(protocol.replace("return text", 'throw new Error("stop"); return text')),
    renderSplit("{ ...otherMethods, " + splitMethod + " }"),
    renderSplit("unknownSeparator"),
    `const alias = separator; const separator = ${regexpProtocol}; ${renderSplit("alias")}`,
    `export const separator = ${regexpProtocol}; ${renderSplit("separator")}`,
    `const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression())}}</>; Highlight({query:"initial"});`,
    `export const Highlight = ({ query }: { query: string }) => { const alias = query; return <>{${renderExpression(splitExpression(regexpProtocol, "`${alias}`"))}}</>; };`,
    `export function Highlight({ query }: { query: string }) { return <>{${renderExpression(splitExpression())}}</>; }`,
    `export const Highlight = ({ query }: { query: string }) => <div>{${renderExpression(splitExpression())}}</div>;`,
    `export const Highlight = ({ query }: { query: string }) => <IgnoreChildren>{${renderExpression(splitExpression())}}</IgnoreChildren>;`,
    `export const Highlight = ({ query }: { query: string }) => <div title={${renderExpression(splitExpression())}} />;`,
    `export const Highlight = ({ query }: { query: string }) => <><span title={fail()} />{${renderExpression(splitExpression())}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => { throw new Error("stop"); return <>{${renderExpression(splitExpression())}}</>; };`,
    renderSplit("/x/"),
    renderSplit('"x"'),
    renderSplit('Object.assign("source", { split() { return ' + reversedRecords + "; } })"),
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), "<b key={index}>text</b>")}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), "<b key={index}>{part.props.name}</b>")}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), "<b key={index} key={index}>{part}</b>")}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), "<b key={index} title={read()}>{part}</b>")}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), "<b key={part.props.name}>{part}</b>")}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => <>{false && ${renderExpression(splitExpression())}}</>;`,
    `export const Highlight = ({ query, enabled }: { query: string; enabled: boolean }) => <>{enabled && ${renderExpression(splitExpression())}}</>;`,
    `export const Highlight = ({ query }: { query: string }) => { if (false) return <>{${renderExpression(splitExpression())}}</>; return null; };`,
    `export const Highlight = ({ query }: { query: string }) => { return null; return <>{${renderExpression(splitExpression())}}</>; };`,
    `export const Highlight = ({ query }: { query: string }) => { notify(); return <>{${renderExpression(splitExpression())}}</>; };`,
    `export const Highlight = ({ query }: { query: string }) => { const ignored = notify(); return <>{${renderExpression(splitExpression())}}</>; };`,
  ])("declines fixed, opaque or non-rendered output: %s", (source) => {
    expectDiagnostics(source, 0);
  });

  it.each([
    ...[
      "number",
      "boolean",
      '"fixed"',
      '"swap"',
      '"fixed" | "other"',
      '"swap" | "fixed"',
      "any",
      "unknown",
      "never",
    ].map((domain) => renderSplit().replace("{ query: string }", `{ query: ${domain} }`)),
    renderSplit().replace("{ query: string }", "{ query?: string }"),
    renderSplit().replace("{ query }: { query: string }", '{ query = "fixed" }: { query: string }'),
    renderSplit().replace(
      "({ query }: { query: string })",
      '({ query }: { query: string } = { query: "fixed" })',
    ),
    "type Query = string; " + renderSplit().replace("{ query: string }", "{ query: Query }"),
    "interface Props { query: string } " + renderSplit().replace("{ query: string }", "Props"),
    "import type { ReactNode } from 'react'; " +
      renderSplit().replace(
        "const Highlight =",
        'const Highlight: (props: { query: "fixed" }) => ReactNode =',
      ),
    "import type { ReactNode } from 'react'; " +
      renderSplit().replace(
        "const Highlight =",
        "const Highlight: (props: { query: string }) => ReactNode =",
      ),
    renderSplit().replace("= ({ query }", "= <Unused,>({ query }"),
    `namespace Private { ${renderSplit()} } export const Root = () => <Private.Highlight query="fixed" />;`,
    `export namespace Public { ${renderSplit()} }`,
    renderSplit().replace("export const", "const"),
    renderSplit().replace("export const", "const") + ' <Highlight query="fixed" />;',
    renderSplit().replace("export const", "const") + " export { Highlight };",
    renderSplit().replace("export const", "const") + " export default Highlight;",
    renderSplit().replace("{ query }: { query: string }", "{ query }"),
  ])("declines restricted or opaque public input domains: %s", (source) => {
    expectDiagnostics(source, 0);
  });

  it("declines an overlong private alias chain", () => {
    const aliases = Array.from(
      { length: FUNCTION_RESOLUTION_MAX_DEPTH + 1 },
      (_unused, index) =>
        `const alias${index} = ${index === 0 ? "separator" : `alias${index - 1}`};`,
    ).join("\n");
    expectDiagnostics(
      `const separator = ${regexpProtocol}; ${aliases} ${renderSplit(`alias${FUNCTION_RESOLUTION_MAX_DEPTH}`)}`,
      0,
    );
  });

  it.each(["index", "String(part)", "process(part)", "<Widget>{part}</Widget>"])(
    "retains existing conservative opaque child reports: %s",
    (child) => {
      expectDiagnostics(
        `export const Highlight = ({ query }: { query: string }) => <>{${renderExpression(splitExpression(), `<b key={index}>{${child}}</b>`)}}</>;`,
        1,
      );
    },
  );

  it.each([
    "separator[Symbol.split] = () => ['text'];",
    "delete separator[Symbol.split];",
    "Object.assign(separator, { [Symbol.split]: () => ['text'] });",
    "replace(separator);",
    "const container = { separator }; replace(container);",
    "const alias = separator; alias[Symbol.split] = () => ['text'];",
    "try {} catch ({ ignored = Object.assign(separator, { [Symbol.split]: () => ['text'] }) }) {}",
    "const mutate = () => Object.assign(separator, { [Symbol.split]: () => ['text'] }); mutate();",
  ])("does not reuse a replaced or exposed method: %s", (mutation) => {
    expectDiagnostics(
      `const separator = ${regexpProtocol}; ${mutation} ${renderSplit("separator")}`,
      0,
    );
  });

  it.each([
    "const Symbol = { split: 'other' };",
    "Symbol = { split: 'other' };",
    "const symbols = { value: Symbol }; symbols.value = replacement;",
    "const constructors = [Object]; replace(constructors);",
    "const strings = { value: String }; replace(strings);",
    "Object.assign = () => /x/;",
    "function change(unused = (Object.assign = () => /x/)) { var Object; } change();",
    "const NativeObject = Object; function change(unused = (NativeObject.assign = () => /x/)) { var NativeObject; } change();",
    "const Host = globalThis; function change(unused = (Host.Object.assign = () => /x/)) { var Host; } change();",
    "function change({ unused = (Object.assign = () => /x/) } = {}) { var Object; } change({});",
    "function change(unused = () => (Object.assign = () => /x/)) { var Object; unused(); } change();",
    'Object.getPrototypeOf("x").split = () => ["text"];',
    '"".__proto__.split = () => ["text"];',
    "Object.getPrototypeOf([]).map = () => [];",
    'const prototype = Object.getPrototypeOf("x"); prototype.split = () => ["text"];',
    'const constructor = "".constructor; constructor.prototype.split = () => ["text"];',
    'Reflect.get("", "__proto__").split = () => ["text"];',
    'const { getPrototypeOf: read } = Object; read("x").split = () => ["text"];',
    'const name = unknownProperty; ""[name].split = () => ["text"];',
    'const read = "".__lookupGetter__("__proto__"); read.call("x").split = () => ["text"];',
    'eval("String.prototype.split = () => [1]");',
    'globalThis.eval("String.prototype.split = () => [1]");',
    'const host = globalThis; host.Function("String.prototype.split = () => [1]")();',
    'const { eval: execute } = globalThis; execute("String.prototype.split = () => [1]");',
    "Array.prototype.map = () => [];",
    "const arrays = Array; arrays.prototype.map = () => [];",
    "const arrays = { value: Array }; replace(arrays);",
    "String.prototype.split = () => ['text'];",
    "Object.defineProperty(String.prototype, 'split', { value: () => ['text'] });",
    "const nativeString = String; nativeString.prototype.split = () => ['text'];",
    "const host = globalThis; host.String = replacement;",
    "try {} catch ({ ignored = (globalThis.String = replacement) }) {}",
  ])("requires proven native providers: %s", (provider) => {
    expectDiagnostics(`${provider} ${renderSplit()}`, 0);
  });
});
