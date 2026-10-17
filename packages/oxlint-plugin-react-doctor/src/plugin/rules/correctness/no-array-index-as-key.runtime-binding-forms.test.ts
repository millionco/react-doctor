import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const scenarios = [
  {
    name: "native baseline",
    code: "interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "genuine local value",
    code: "const Object = { note: 0 };void Object;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "interface after genuine local value",
    code: "const Object = { note: 0 };interface Object {}void Object;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "interface before genuine local value",
    code: "interface Object {}const Object = { note: 0 };void Object;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: "const Object = { note: 0 };const inspectProvider = () => { interface Object {} void Object; };interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type Object = require("provider-types");Object.defineProperty(Object.getPrototypeOf([]),"map",{value:()=>[{id:"outside"}]});interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace Object {}",
    code: 'namespace Object {}Object.defineProperty(Object.getPrototypeOf([]),"map",{value:()=>[{id:"outside"}]});interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace Object { export interface Marker {} }",
    code: 'namespace Object { export interface Marker {} }Object.defineProperty(Object.getPrototypeOf([]),"map",{value:()=>[{id:"outside"}]});interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace Object { export namespace Nested { export interface Marker {} } }",
    code: 'namespace Object { export namespace Nested { export interface Marker {} } }Object.defineProperty(Object.getPrototypeOf([]),"map",{value:()=>[{id:"outside"}]});interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n',
    expected: 1,
  },
  {
    name: "runtime namespace remains a real local value",
    code: "namespace Object { export const note = 0; } void Object;interface SlotProps { label: string }\nconst Slot = ({ label }: SlotProps) => <input defaultValue={label} />;\nexport const SlotGallery = () => { const count = 6; const slots = new Array(count).fill(null).map((unused, position) => position); return <section>{slots.map((unused, index) => <Slot key={index} label={`Position ${index + 1}`} />)}</section>; };\n",
    expected: 0,
  },
];
const options = {
  filename: "src/slot-gallery.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      capabilities: ["react", "react:19"],
      portedRuleMode: "curated",
    },
  },
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noArrayIndexAsKey, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
