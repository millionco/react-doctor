import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "unmasked-native-map-mutation",
    code: 'Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] }); interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "ambient-object-native-map-mutation",
    code: 'declare const Object: any; Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] }); interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "erased-interface-native-map-mutation",
    code: 'interface Object {} Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] }); interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "erased-type-import-native-map-mutation",
    code: 'import type { Object } from "types"; Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] }); interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "inert-ambient-object-keeps-placeholder-proof",
    code: "declare const Object: any; interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "inert-type-import-keeps-placeholder-proof",
    code: 'import type { Object } from "types"; interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 0,
  },
  {
    name: "genuine-local-object-keeps-placeholder-proof",
    code: 'const Object = { defineProperty: () => null, getPrototypeOf: () => ({}) }; Object.defineProperty(Object.getPrototypeOf([]), "map", { value: () => [{ id: "outside" }] }); interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 0,
  },

  {
    name: "closed-placeholder-index-projection",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "direct-placeholder-control",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "data-backed-input",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\ninterface GalleryProps { rows: SlotProps[] }\nexport const SlotGallery = ({ rows }: GalleryProps) => <section>{rows.map((row, index) => <Slot key={index} label={row.label} />)}</section>;\n",
    expected: 1,
  },
  {
    name: "data-returning-projection",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\ninterface GalleryProps { rows: SlotProps[] }\nexport const SlotGallery = ({ rows }: GalleryProps) => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => rows[position]); return <section>{slots.map((row, index) => <Slot key={index} label={row.label} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "literal-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(6).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "call-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "unrelated-window-read",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const screenWidth=window.innerWidth; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "actual-shaped-closed-jsx-data",
    code: 'interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const attributes=[{tone:"calm"}]; const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => {const props=attributes[index % attributes.length]; return <Slot {...props} key={index} label={`Position ${index + 1}`} />;})}</section>; };\n',
    expected: 0,
  },
  {
    name: "data-derived-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = rows.length; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "typed-unknown-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count: number = readCount(); const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "fractional-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 2.5; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "negative-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = -1; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "string-count",
    code: 'interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = "6"; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "mutable-count",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { let count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "count-reassignment",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; count=7; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-alias",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); const alias=slots; consume(alias); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-argument-escape",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); consume(slots); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-method-escape",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); consume(slots.map); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-sort",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); slots.sort(); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-pattern-write",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); ({value:slots}=replacement); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-loop-write",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); for(slots of replacements){} return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "result-method-write",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); slots.map=replacement; return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "index-transform",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position+1); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-block",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => {return position;}); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-side-effect",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => (consume(position),position)); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-default",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position=0) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-rest",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, ...positions) => positions[0]); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-collection",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position, collection) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-item-read",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => unused); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-async",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map(async (unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "mapper-this-argument",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position, receiver); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "fill-non-null",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(item).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "constructor-spread",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(...counts).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "computed-map",
    code: 'interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null)["map"]((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "optional-map",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null)?.map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "shadowed-array",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const Array=CustomArray; const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "array-alias",
    code: "const Provider=Array;Provider.prototype.map=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "array-prototype",
    code: "Array.prototype.map=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "array-computed-write",
    code: 'Array["prototype"]["map"]=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "pattern-provider-write",
    code: "({value:Array.prototype.map}=replacement);interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "loop-provider-write",
    code: "for(Array.prototype.map of replacements){}interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "reflect-provider",
    code: 'Reflect.set(Array.prototype,"map",replacement);interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "object-provider",
    code: 'Object.defineProperty(Array.prototype,"map",{value:replacement});interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "literal-constructor-carrier",
    code: "const Provider=[].constructor;Provider.prototype.map=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "dynamic-native-carriers",
    code: 'const proto=[][key];const define=({})[otherKey];define.call(proto,"map",replacement);interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "literal-carrier-alias",
    code: "const empty=[];const proto=empty[key];consume(proto);interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "destructured-prototype-carrier",
    code: 'const {__proto__:proto}=[];proto.__defineGetter__("map",replacement);interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "window-array-provider",
    code: "window.Array.prototype.map=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "global-array-provider",
    code: "globalThis.Array.prototype.map=replacement;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "renderer-third-argument-reorder",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = ({ reverseSlots }) => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((value,index,collection)=>{if(reverseSlots)collection.reverse();return <Slot key={index} label={String(value)}/>;})}</section>; };\n",
    expected: 1,
  },
  {
    name: "renderer-normal-function-arguments",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map(function(value,index){arguments[2].reverse();return <Slot key={index} label={String(value)}/>;})}</section>; };\n",
    expected: 1,
  },
  {
    name: "renderer-unread-collection-parameter",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index, collection) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 1,
  },
  {
    name: "renderer-this-argument",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />, receiver)}</section>; };\n",
    expected: 1,
  },
];
const options = {
  filename: "src/slot-gallery.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react", "react:19"],
      portedRuleMode: "curated",
    },
  },
};
describe("no-array-index-as-key placeholder projection", () => {
  for (const { name, code, expected } of cases) {
    it(name, () => {
      const result = runRule(noArrayIndexAsKey, code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
