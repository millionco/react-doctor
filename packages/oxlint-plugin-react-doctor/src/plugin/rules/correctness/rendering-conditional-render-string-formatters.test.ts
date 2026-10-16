import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

const stringFormatterCases = [
  {
    name: "direct local declaration string result",
    code: "function formatLabel(value) { return `${value} units`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 0,
  },
  {
    name: "template or undefined result",
    code: "function formatLabel(value) { if (!value) return undefined; return `${value} units`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 0,
  },
  {
    name: "bare return and fallthrough",
    code: 'function formatLabel(value) { if (!value) return; if (value.active) return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "literal arrow result",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "concatenated string on right",
    code: 'const formatLabel = (value) => value + " units"; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "nested concatenated string",
    code: 'const formatLabel = (value) => "units " + value / 100; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "const function expression",
    code: 'const formatLabel = function(value) { return "ready"; }; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "nested returns excluded",
    code: "function formatLabel(value) { const unrelated = () => 0; class Holder { read() {return 0;} } return `${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 0,
  },
  {
    name: "own loop opaque return shape",
    code: "function formatLabel(value) { while(value > 10) { value /= 10; } return `${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 0,
  },
  {
    name: "unexecuted numeric return still deferred",
    code: "function formatLabel(value) { if (false) return 0; return `${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "numeric alternative return",
    code: "function formatLabel(value) { if (!value) return 0; return `${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "unknown alternative return",
    code: "function formatLabel(value) { if (!value) return other; return `${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "numeric formatter",
    code: "function formatLabel(value) { return 0; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "annotation is not return proof",
    code: "const formatLabel = (value): string => 0 as string; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "type assertion string value retains runtime proof",
    code: 'const formatLabel = (value) => ("ready" as string); const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "tagged template is unknown",
    code: "function formatLabel(value) { return tag`${value}`; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "shadowed undefined is not safe",
    code: 'function formatLabel(undefined) { if (!undefined) return undefined; return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "finally numeric override",
    code: 'function formatLabel(value) { try { return "ready"; } finally { return 0; } } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "undefined only is outside profile",
    code: "function formatLabel(value) { return undefined; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "async formatter",
    code: 'async function formatLabel(value) { return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "generator formatter",
    code: 'function* formatLabel(value) { return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "parameter default deferred",
    code: 'function formatLabel(value = 0) { return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "parameter rest deferred",
    code: 'function formatLabel(...value) { return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "parameter pattern deferred",
    code: 'function formatLabel({value}) { return "ready"; } const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "function assignment rejected",
    code: 'function formatLabel(value) {return "ready";} formatLabel = replacement; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "function pattern write rejected",
    code: 'function formatLabel(value) {return "ready";} [formatLabel] = replacements; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "function loop target rejected",
    code: 'function formatLabel(value) {return "ready";} for(formatLabel of replacements) {} const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "formatter escape rejected",
    code: 'function formatLabel(value) {return "ready";} expose(formatLabel); const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "formatter alias rejected",
    code: 'function formatLabel(value) {return "ready";} const alias = formatLabel; const Panel = (props) => { const fileSize = alias(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "direct export rejected",
    code: 'export function formatLabel(value) {return "ready";} const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "const export rejected",
    code: 'export const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "export specifier rejected",
    code: 'function formatLabel(value) {return "ready";} export {formatLabel}; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "imported formatter deferred",
    code: 'import {formatLabel} from "formatter"; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "unresolved formatter deferred",
    code: " const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 1,
  },
  {
    name: "member formatter deferred",
    code: 'const helpers = {formatLabel: (value) => "ready"}; const Panel = (props) => { const fileSize = helpers.formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "optional call deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel?.(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "spread call deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(...props.values);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "extra arguments deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value, props.other);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "zero arguments deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel();  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "mutable result deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { let fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "result assignment rejected",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value); fileSize = 0;  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "result pattern assignment rejected",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value); [fileSize] = [0];  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "result destructuring deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const {fileSize = formatLabel(props.value)} = props;  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "state string writer deferred",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const [fileSize,setFileSize] = useState(""); useEffect(()=>setFileSize(formatLabel(props.value)),[props.value]);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "numeric length remains warning",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize.length && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "direct eval prevents private binding proof",
    code: 'function formatLabel(value) {return "ready";} eval("formatLabel = replacement"); const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "shadowed eval is separate",
    code: 'const eval = () => null; eval(); function formatLabel(value) {return "ready";} const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "type query formatter read",
    code: 'const formatLabel = (value) => "ready"; type Formatter = typeof formatLabel; const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 0,
  },
  {
    name: "additional call from asynchronous callback",
    code: " const Panel = (props) => { const formatLabel = (value) => `${value}`; const fileSize = formatLabel(props.value); useEffect(async()=>{ await wait(); formatLabel(props.value); }, []); return <section>{fileSize && <span>Ready</span>}</section>; };",
    expected: 0,
  },
  {
    name: "inner shadowed numeric formatter",
    code: 'const formatLabel = (value) => "ready"; const Panel = (props) => { const formatLabel = (value) => 0; const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "recursive unknown returned call",
    code: 'function formatLabel(value) {if(value) return formatLabel(value.next);return "ready";} const Panel = (props) => { const fileSize = formatLabel(props.value);  return <section>{fileSize && <span>Ready</span>}</section>; };',
    expected: 1,
  },
  {
    name: "recursive statement deferred",
    code: "function formatLabel(value) { if(value) formatLabel(value.next); return `${value}`; } const Panel = (props) => {const fileSize = formatLabel(props.value); return <section>{fileSize && <span>Ready</span>}</section>;};",
    expected: 1,
  },
  {
    name: "named function self-binding deferred",
    code: 'const formatLabel = function inner(value) {if(value) inner(value.next); return "ready";}; const Panel = (props) => {const fileSize = formatLabel(props.value); return <section>{fileSize && <span>Ready</span>}</section>;};',
    expected: 1,
  },
  {
    name: "own declaration self assignment rejected",
    code: 'function formatLabel(value) {formatLabel = () => 0; return "ready";} const Panel = (props) => {formatLabel(props.value);const fileSize = formatLabel(props.value);return <section>{fileSize && <span>Ready</span>}</section>;};',
    expected: 1,
  },
];

describe("rendering-conditional-render local string formatters", () => {
  it.each(stringFormatterCases)("$name", ({ code, expected }) => {
    const result = runRule(renderingConditionalRender, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
