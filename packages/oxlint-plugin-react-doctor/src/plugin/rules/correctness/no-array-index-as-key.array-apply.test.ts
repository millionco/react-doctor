import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("no-array-index-as-key Array.apply slots", () => {
  const supportedControls = [
    "const Slots = (count: number) => (Array.apply(0, Array(count)) as number[]).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => Array['apply'](0, new Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => { const count = 4; return Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} position={index} />); };",
    "const Slots = () => Array.apply(0, Array(0)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = (count: number) => Array.apply(0, Array(count)).map((unused, index, collection) => <Tile key={index} position={index} />);",
    "const unrelated = (Array) => Array.apply; const Slots = (count: number) => Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} position={index} />);",
  ];
  it.each(supportedControls)("accepts proven generated positions: %s", (code) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  const rejectedControls = [
    '(() => {}).constructor("Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);',
    'const NativeConstructor = (() => {}).constructor; NativeConstructor("Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);',
    "(() => {})['constructor'](\"Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }\")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const property = 'constructor'; (() => {})[property](\"Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }\")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    'const { constructor: NativeConstructor } = () => {}; NativeConstructor("Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);',
    'const property = "constructor"; const { [property]: NativeConstructor } = () => {}; NativeConstructor("Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }")();const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);',
    "const callbackInfo = function() {}.caller; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const callbackInfo = function() {}.callee; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "let selected; ({[metadata.key]: selected} = source); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "let selected; ({selected = metadata.defaultValue} = source); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",

    "const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />, receiver);",
    "const Slots = () => Array.apply(0, Array(4)).map((unused, index) => { const later = () => <Tile key={index} position={index} />; return later(); });",

    "[].constructor.__proto__.apply = replacement; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const prototype = [].constructor.__proto__; prototype.apply = replacement; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Object.defineProperty(Object.prototype, '0', { value: record }); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => Array.apply(0, Array(4)).map(function(unused, index) { return <Tile key={index} position={index} value={arguments[0]} />; });",
    "const Slots = () => Array.apply(0, Array(4)).map(function(unused, index) { return <Tile key={index} value={this.items[index]} />; });",
    "const Slots = () => Array.apply(0, Array(4)).map(function callback(unused, index) { return <Tile key={index} position={index} value={callback.arguments[0]} />; });",
    "const Slots = () => Array.apply(0, Array(4)).map((unused, index, ...collection) => <Tile key={index} value={collection[0]} />);",
    "const Slots = () => Array.apply(0, Array(4)).map((unused, index) => { index = selected; return <Tile key={index} position={index} />; });",

    "const Slots = (items) => Array.apply(0, items).map((item, index) => <Tile key={index} value={item} />);",
    "const Slots = () => Array.apply(0, Array(first, second)).map((item, index) => <Tile key={index} value={item} />);",
    "const Slots = () => Array.apply(0, Array(...items)).map((item, index) => <Tile key={index} value={item} />);",
    "const Slots = (Array) => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "import Array from './custom-array'; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Array = customArray; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Array.apply = customApply; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "delete Array.apply; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Array[method] = customApply; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "({ apply: Array.apply } = replacement); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Constructor = Array; Constructor.apply = customApply; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "mutate(Array); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "mutate(Array.apply); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Object.defineProperty(Array, 'apply', { value: customApply }); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Function.prototype.apply = customApply; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "Array.prototype[0] = first; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "globalThis.Array = customArray; const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = (count: number, items) => Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} value={items[index]} />);",
    "const Slots = (count: number, items) => Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} value={readItem(index)} />);",
    "const Slots = (count: number) => Array.apply(0, Array(count)).map((item, index) => <Tile key={index} value={item} />);",
    "const Slots = (count: number) => Array.apply(0, Array(count)).map((unused, index, items) => <Tile key={index} value={items[index]} />);",
    "const Slots = (count) => Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = (count: number) => { count = next; return Array.apply(0, Array(count)).map((unused, index) => <Tile key={index} position={index} />); };",
    "const Slots = () => Array.apply(0, Array(readCount())).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => Array.apply(null, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "const Slots = () => Array[method](0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
    "eval(source); const Slots = () => Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);",
  ];
  it.each(rejectedControls)("keeps data and unsupported provenance warned: %s", (code) => {
    const result = runRule(noArrayIndexAsKey, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
