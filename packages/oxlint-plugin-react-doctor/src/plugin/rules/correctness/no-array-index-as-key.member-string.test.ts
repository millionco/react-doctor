import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const renderRecords = (
  producer = 'const records = [{ token: "A A", id: "first" }];',
  before = "",
  child = "{part}",
  separator = '" "',
): string => `
import { useCallback } from "react";
const View = () => {
  const getRecords = useCallback(() => { ${producer} return records; }, []);
  const records = getRecords();
  const visible = records.filter(record => record.id.length > 0);
  ${before}
  return visible.map(record => <div key={record.id}>{record.token.split(${separator}).map((part, index) => <span key={index} className="token">${child}</span>)}</div>);
};`;

const check = (source: string, count: number): void => {
  const result = runRule(noArrayIndexAsKey, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

const eventRecords = (before = "", receiver = "div", extra = ""): string => `
import { useCallback, useEffect } from "react";
const View = ({ action }) => {
  const getRecords = useCallback(() => { const records=[{token:"A A",id:"first",action}];return records; },[]);
  const records=getRecords();
  const invoke=useCallback(()=>{records[0].action();},[records]);
  const keydown=useCallback(()=>invoke(),[invoke]);
  useEffect(()=>{window.addEventListener("keydown",keydown);return ()=>window.removeEventListener("keydown",keydown);},[keydown]);
  ${before} ${extra}
  return records.map(record=><${receiver} key={record.id} onClick={()=>invoke()}>{record.token.split(" ").map((part,index)=><span key={index}>{part}</span>)}</${receiver}>);
};`;

describe("local record string tokens", () => {
  it("accepts fresh records whose opaque receiver calls occur only in native JSX/effect event entries", () =>
    check(eventRecords(), 0));
  it("retains a named callback self-binding", () =>
    check(
      eventRecords().replace(
        "useCallback(()=>{records[0].action();}",
        "useCallback(function Inner(){records[0].action();}",
      ),
      1,
    ));
  it("retains a render-phase opaque receiver call", () => check(eventRecords("invoke();"), 1));
  it("retains an opaque callback escape", () => check(eventRecords("unknown(invoke);"), 1));
  it("retains a custom JSX provider that may call during render", () =>
    check(eventRecords("", "Widget"), 1));
  it("retains a source-visible event API replacement", () =>
    check(eventRecords("window.addEventListener=unknown;"), 1));
  it("retains a callback passed to an opaque event source", () =>
    check(eventRecords("unknown(keydown);"), 1));
  it("retains direct calls on the rendering item", () =>
    check(
      renderRecords('const records=[{token:"A",id:"first",action:unknown}];').replace(
        "record.token.split",
        "(record.action(),record.token).split",
      ),
      1,
    ));
  it.each([
    [
      "filter third collection",
      "records.filter((record, index, collection) => { collection[0].token=unknown(); return true; })",
    ],
    [
      "filter rest collection",
      "records.filter((record, ...extra) => { extra[1][0].token=unknown(); return true; })",
    ],
    [
      "filter own arguments",
      "records.filter(function(record) { arguments[2][0].token=unknown(); return true; })",
    ],
  ])("retains %s", (_name, receiver) =>
    check(renderRecords().replace("records.filter(record => record.id.length > 0)", receiver), 1),
  );
  it.each([
    [
      "map third collection",
      "(record, index, collection) => { collection[0].token=unknown(); return ",
    ],
    ["map own first argument", "function(record) { arguments[0].token=unknown(); return "],
    ["map own collection argument", "function(record) { arguments[2][0].token=unknown(); return "],
    ["map captured arguments", "record => { unknown(arguments[0]); return "],
  ])("retains %s", (_name, callback) =>
    check(
      renderRecords()
        .replace("visible.map(record => ", "visible.map(" + callback)
        .replace("</div>);", "</div>});"),
      1,
    ),
  );
  it("retains opaque token callback arguments", () =>
    check(
      renderRecords()
        .replace(
          "(part, index) => <span",
          "function(part, index) { unknown(arguments[2]); return <span",
        )
        .replace("</span>)", "</span>})"),
      1,
    ));
  it("retains a producer using arguments", () =>
    check(
      renderRecords().replace(
        "useCallback(() => {",
        "useCallback(function(){ unknown(arguments[0]);",
      ),
      1,
    ));
  it("retains a producer using this", () =>
    check(
      renderRecords().replace("useCallback(() => {", "useCallback(function(){ unknown(this);"),
      1,
    ));
  it("retains a module-created factory result across renders", () =>
    check(
      `
import {useCallback,useEffect} from 'react';
const getRecords=()=>[{token:"A",action:unknown}];
const records=getRecords();
const View=()=>{const invoke=useCallback(()=>records[0].action(),[records]);
useEffect(()=>{window.addEventListener("click",invoke);return()=>window.removeEventListener("click",invoke);},[invoke]);
return records.map(record=>record.token.split(" ").map((part,index)=><span key={index}>{part}</span>));};`,
      1,
    ));
  it("accepts fresh results allocated by an external literal factory during render", () =>
    check(
      `
const getRecords=()=>[{token:"A"}];
const View=()=>{const records=getRecords();return records.map(record=>record.token.split(" ").map((part,index)=><span key={index}>{part}</span>));};`,
      0,
    ));
  it("retains a factory that returns a captured array", () =>
    check(
      `
import {useCallback} from 'react';
const View=()=>{const cached=[{token:"A"}];const factory=useCallback(()=>cached,[]);const records=factory();
return records.map(record=>record.token.split(" ").map((part,index)=><span key={index}>{part}</span>));};`,
      1,
    ));
  it.each([
    "metadata.value = 1;",
    "metadata.value++;",
    "delete metadata.value;",
    "for (metadata.value of source) {}",
    "({value: metadata.value} = source);",
    "[metadata.value = 1] = [];",
    "({...metadata.value} = source);",
  ])("retains source-visible member mutation %s", (before) =>
    check(renderRecords(undefined, before), 1),
  );
  it.each([
    "let target; const propertyName='value'; ({[propertyName]: target} = source);",
    "let target; [target = metadata.value] = [];",
    "const value = metadata.value;",
  ])("preserves supported read-only syntax %s", (before) =>
    check(renderRecords(undefined, before), 0),
  );
  it("retains a dynamic primitive prototype replacement", () =>
    check(renderRecords(undefined, 'const primitive="";primitive[property].split=()=>items;'), 1));
  it("retains an opaque constructor read from a function literal", () =>
    check(
      renderRecords(undefined, 'const construct=(()=>{})[property];construct("return 1")();'),
      1,
    ));
  it("retains an opaque constructor read from a function alias", () =>
    check(
      renderRecords(
        undefined,
        'const provider=()=>{};const construct=provider[property];construct("return 1")();',
      ),
      1,
    ));
  it("retains native dynamic Function execution", () =>
    check(renderRecords(undefined, 'Function("return 1")();'), 1));
  it("retains an opaque prototype input from a primitive alias", () =>
    check(renderRecords(undefined, 'const primitive="";unknown(primitive[property]);'), 1));
  it("retains an opaque prototype input from a literal array", () =>
    check(renderRecords(undefined, "const values=[];unknown(values[property]);"), 1));
  it("retains an opaque prototype input from the record string", () =>
    check(
      renderRecords()
        .replace("record => <div", "record => (unknown(record.token[property]), <div")
        .replace("</div>);", "</div>));"),
      1,
    ));
  it.each([
    "const {constructor: construct}=()=>{}; construct('values','String.prototype.split=()=>values')(items);",
    "const {[property]: construct}=()=>{}; unknown(construct);",
    "const {caller}=provider; unknown(caller);",
    "const {callee}=provider; unknown(callee);",
    "const {__proto__: prototype}=provider; unknown(prototype);",
  ])("retains native pattern exposure %s", (before) => check(renderRecords(undefined, before), 1));
  it("retains an unresolved computed key by native-exposure policy", () =>
    check(renderRecords(undefined, "let target; ({[metadata.value]: target}=source);"), 1));
  it.each([
    "const execute=globalThis.eval;execute('String.prototype.split=()=>[]');",
    "const reflection=globalThis.Reflect;unknown(reflection);",
  ])("retains native namespace exposure %s", (before) =>
    check(renderRecords(undefined, before), 1),
  );
  it("accepts own literal string tokens through a local callback return and filter", () =>
    check(renderRecords(), 0));
  it.each([
    'interface Object {} Object.defineProperty(Object.getPrototypeOf(""), "split", {value: customSplit});',
    'import type Object = require("./types"); Object.defineProperty(Object.getPrototypeOf(""), "split", {value: customSplit});',
    'namespace Object {}Object.defineProperty(Object.getPrototypeOf(""),"split",{value:customSplit});',
    'namespace Object {export namespace Shape {export interface Marker {}}}Object.defineProperty(Object.getPrototypeOf(""),"split",{value:customSplit});',
    'declare const Function: any; Function("String.prototype.split = customSplit")();',
    'import type {Reflect} from "./types"; Reflect.set(Object.getPrototypeOf(""), "split", customSplit);',
  ])("retains runtime exposure through erased declarations: %s", (exposure) =>
    check(`${exposure} ${renderRecords()}`, 1),
  );
  it.each([
    "interface Object {}",
    "declare const Function: any;",
    'import type {Reflect} from "./types";',
    'const Object = {getPrototypeOf: () => null}; Object.getPrototypeOf("");',
    'namespace Object {export const defineProperty=()=>null;export const getPrototypeOf=()=>({});}Object.defineProperty(Object.getPrototypeOf(""),"split",{value:customSplit});',
    'const Object={defineProperty(){},getPrototypeOf(){return {}}}; interface Object {} Object.defineProperty(Object.getPrototypeOf(""),"split",{value:customSplit});',
  ])("allows inert declarations and real local reflection: %s", (metadata) =>
    check(`${metadata} ${renderRecords()}`, 0),
  );
  it("accepts a direct literal array", () =>
    check(
      'const View=()=>[{token:"A A"}].map(record=>record.token.split(" ").map((part,index)=><span key={index}>{part}</span>));',
      0,
    ));
  it("accepts a plain local arrow producer", () =>
    check(renderRecords().replace("useCallback(() => {", "(() => {").replace("}, []);", "});"), 0));
  it.each([
    [
      "custom split object",
      'const records = [{ token: { split: () => [{ value: "A" }] }, id: "first" }];',
    ],
    ["unknown field", 'const records = [{ token: unknown(), id: "first" }];'],
    ["mixed field", 'const records = [{token:"A",id:"first"},{token:unknown(),id:"second"}];'],
    ["getter", 'const records = [{ get token(){return "A";}, id: "first" }];'],
    ["spread", 'const records = [{token:"A",id:"first",...unknown()}];'],
    ["duplicate key", 'const records = [{token:"A",token:unknown(),id:"first"}];'],
    ["prototype", 'const records = [{token:"A",id:"first",__proto__:unknown()}];'],
    ["computed property", 'const records = [{[unknown()]:"A",token:"A",id:"first"}];'],
    ["array spread", "const records = [...unknown()];"],
    ["opaque collection", "const records = unknown();"],
    ["mutable collection", 'let records = [{token:"A",id:"first"}];'],
  ])("retains %s", (_label, producer) => check(renderRecords(producer), 1));
  it.each([
    ["member replacement", "visible[0].token = { split: () => [] };"],
    ["element alias replacement", "const record = visible[0]; record.token = { split: () => [] };"],
    ["collection escape", "unknown(visible);"],
    ["returned collection escape", "const leak=()=>visible;unknown(leak);"],
    [
      "filter-result escape",
      "const escaped = records.filter(record => record.id); unknown(escaped);",
    ],
    ["method replacement", "visible.map = unknown;"],
    ["string prototype replacement", "String.prototype.split = unknown;"],
    ["array prototype replacement", "Array.prototype.map = unknown;"],
    ["global realm alias", "const realm = globalThis; unknown(realm);"],
    ["computed realm access", "globalThis[unknown()] = unknown();"],
    ["iterator replacement", "visible[Symbol.iterator] = unknown;"],
  ])("retains %s", (_label, before) => check(renderRecords(undefined, before), 1));
  it.each(["<input defaultValue={part}/>", "<Widget value={part}/>", "{unknown(part)}"])(
    "retains stateful descendant %s",
    (child) => check(renderRecords(undefined, undefined, child), 1),
  );
  it("retains token handlers", () =>
    check(renderRecords().replace('className="token"', "onClick={()=>unknown(part)}"), 1));
  it("retains token refs", () =>
    check(renderRecords().replace('className="token"', "ref={unknown}"), 1));
  it("retains opaque split separator", () =>
    check(renderRecords(undefined, undefined, undefined, "unknown()"), 1));
  it("retains opaque split limit", () =>
    check(renderRecords(undefined, undefined, undefined, '" ", unknown()'), 1));
  it("retains a shadowed callback provider", () =>
    check(renderRecords().replace("const View = () => {", "const View = (useCallback) => {"), 1));
  it("retains mutated callback provider", () =>
    check(
      renderRecords().replace(
        "const View = () => {",
        "useCallback = unknown; const View = () => {",
      ),
      1,
    ));
  it("retains map parameter writes", () =>
    check(
      renderRecords()
        .replace("record => <div", "record => (record.token=unknown(), <div")
        .replace("</div>);", "</div>));"),
      1,
    ));
  it("does not widen character-array exemptions", () =>
    check(
      'const View=()=>[{token:"A"}].map(record=>[...record.token].map((part,index)=><input key={index} defaultValue={part}/>));',
      1,
    ));
});
