import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

describe("hook-use-state omitted setters", () => {
  it.each([
    [
      "constant initial number",
      'import {useState} from "react"; const [seededTotal] = useState(7);',
    ],
    [
      "prop snapshot",
      'import {useState} from "react"; const useSeed = (initialLabel) => {const [storedLabel] = useState(initialLabel); return storedLabel;};',
    ],
    [
      "eager allocation",
      'import {useState} from "react"; const [cacheHandle] = useState(new Map());',
    ],
    [
      "lazy allocation",
      'import {useState} from "react"; const [cacheHandle] = useState(() => new Map());',
    ],
    [
      "imported factory",
      'import {useState} from "react"; import {makeCache} from "./cache"; const [cacheHandle] = useState(makeCache);',
    ],
    [
      "returned function value",
      'import {useState} from "react"; const [fetchNext] = useState(() => () => 7);',
    ],
    [
      "promise value",
      'import {useState} from "react"; const [pendingResult] = useState(() => Promise.resolve(7));',
    ],
    ["default React import", 'import React from "react"; const [seededTotal] = React.useState(7);'],
    [
      "namespace React import",
      'import * as React from "react"; const [seededTotal] = React.useState(7);',
    ],
    [
      "direct CommonJS provider",
      'const React = require("react"); const [seededTotal] = React.useState(7);',
    ],
    ["trailing comma", 'import {useState} from "react"; const [seededTotal,] = useState(7);'],
    [
      "value member mutation",
      'import {useState} from "react"; const [cacheHandle] = useState(() => ({entry: 7})); cacheHandle.entry = 8;',
    ],
    [
      "hook metadata",
      'import {useState} from "react"; useState.description = "stable"; const [seededTotal] = useState(7);',
    ],
    [
      "provider metadata",
      'import React from "react"; React.description = "stable"; const [seededTotal] = React.useState(7);',
    ],
    [
      "member-pattern metadata",
      'import React from "react"; ({metadata: React.description} = source); const [seededTotal] = React.useState(7);',
    ],
    [
      "default RHS reads",
      'import React from "react"; ({callback: other = React.useState} = source); const [seededTotal] = React.useState(7);',
    ],
    [
      "value metadata pattern",
      'import {useState} from "react"; const [cacheHandle] = useState(() => ({})); ({entry: cacheHandle.entry} = source);',
    ],
    [
      "value default RHS read",
      'import {useState} from "react"; const [seededTotal] = useState(7); ({total: other = seededTotal} = source);',
    ],
  ])("allows %s", (_name, code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    [
      "unresolved pattern computed key reads",
      'import React from "react"; ({[React.useState]: other} = source); const [seededTotal] = React.useState(7);',
    ],
    [
      "unresolved pattern value computed key read",
      'import {useState} from "react"; const [seededTotal] = useState(7); ({[seededTotal]: other} = source);',
    ],
    ["uppercase value", 'import {useState} from "react"; const [TOTAL] = useState(7);'],
    ["underscore value", 'import {useState} from "react"; const [_total] = useState(7);'],
    ["top-level default", 'import {useState} from "react"; const [seededTotal = 7] = useState();'],
    ["top-level rest", 'import {useState} from "react"; const [...retainedTuple] = useState(7);'],
    ["empty tuple", 'import {useState} from "react"; const [] = useState(7);'],
    [
      "object tuple binding",
      'import {useState} from "react"; const {0: seededTotal} = useState(7);',
    ],
    [
      "extra tuple slot",
      'import {useState} from "react"; const [seededTotal, setSeededTotal, extra] = useState(7);',
    ],
    [
      "wrong actual setter",
      'import {useState} from "react"; const [seededTotal, updateTotal] = useState(7);',
    ],
    [
      "underscore actual setter",
      'import {useState} from "react"; const [seededTotal, _setSeededTotal] = useState(7);',
    ],
    ["mutable declaration", 'import {useState} from "react"; let [seededTotal] = useState(7);'],
    [
      "actual value reassignment",
      'import {useState} from "react"; const [seededTotal] = useState(7); seededTotal = 8;',
    ],
    [
      "pattern binding reassignment",
      'import {useState} from "react"; const [seededTotal] = useState(7); ({total: seededTotal} = source);',
    ],
    [
      "default pattern binding reassignment",
      'import {useState} from "react"; const [seededTotal] = useState(7); ({total: seededTotal = 8} = source);',
    ],
    [
      "update binding",
      'import {useState} from "react"; const [seededTotal] = useState(7); seededTotal++;',
    ],
    [
      "for-of binding",
      'import {useState} from "react"; const [seededTotal] = useState(7); for (seededTotal of source) {}',
    ],
    [
      "shadowed hook",
      'import {useState} from "react"; const useSeed = (useState) => {const [seededTotal] = useState(7); return seededTotal;};',
    ],
    ["local hook spelling", "const useState = () => [7]; const [seededTotal] = useState(7);"],
    ["unbound hook spelling", "const [seededTotal] = useState(7);"],
    [
      "custom React provider",
      "const React = {useState: () => [7]}; const [seededTotal] = React.useState(7);",
    ],
    [
      "type-only declaration",
      'import type {useState} from "react"; const [seededTotal] = useState(7);',
    ],
    [
      "type-only specifier",
      'import {type useState} from "react"; const [seededTotal] = useState(7);',
    ],
    [
      "hook binding replacement",
      'import {useState} from "react"; useState = customHook; const [seededTotal] = useState(7);',
    ],
    [
      "hook function escape",
      'import {useState} from "react"; install(useState); const [seededTotal] = useState(7);',
    ],
    [
      "namespace hook replacement",
      'import React from "react"; React.useState = customHook; const [seededTotal] = React.useState(7);',
    ],
    [
      "sibling provider replacement",
      'import {useState} from "react"; import React from "react"; React.useState = customHook; const [seededTotal] = useState(7);',
    ],
    [
      "provider escape",
      'import React from "react"; install(React); const [seededTotal] = React.useState(7);',
    ],
    [
      "provider method escape",
      'import React from "react"; install(React.useState); const [seededTotal] = React.useState(7);',
    ],
    [
      "provider Object.assign replacement",
      'import React from "react"; Object.assign(React, {useState: customHook}); const [seededTotal] = React.useState(7);',
    ],
    [
      "provider pattern replacement",
      'import React from "react"; ({callback: React.useState} = source); const [seededTotal] = React.useState(7);',
    ],
    [
      "provider default pattern replacement",
      'import React from "react"; ({callback: React.useState = customHook} = source); const [seededTotal] = React.useState(7);',
    ],
    [
      "provider for-of replacement",
      'import React from "react"; for (React.useState of source) {} const [seededTotal] = React.useState(7);',
    ],
    [
      "sibling namespace pattern replacement",
      'import {useState} from "react"; import * as Provider from "react"; ({callback: Provider.useState} = source); const [seededTotal] = useState(7);',
    ],
    [
      "CJS provider shadow",
      'const require = () => ({useState: () => [7]}); const React = require("react"); const [seededTotal] = React.useState(7);',
    ],
    [
      "CJS projected provider",
      'const React = require("react").custom; const [seededTotal] = React.useState(7);',
    ],
    [
      "CJS mutable provider",
      'let React = require("react"); const [seededTotal] = React.useState(7);',
    ],
    [
      "CJS escaped provider",
      'const React = require("react"); install(React); const [seededTotal] = React.useState(7);',
    ],
    [
      "CJS extra loader argument",
      'const React = require("react", options); const [seededTotal] = React.useState(7);',
    ],
    [
      "CJS deferred initialization",
      'const [seededTotal] = React.useState(7); const React = require("react");',
    ],
    [
      "hybrid CJS provider exposure",
      'import {useState} from "react"; const Provider = require("react"); Provider.useState = customHook; const [seededTotal] = useState(7);',
    ],
    [
      "CJS pattern replacement",
      'const React = require("react"); ({callback: React.useState} = source); const [seededTotal] = React.useState(7);',
    ],
  ])("retains %s", (_name, code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const React = require("react"); with (provider) { const [seededTotal] = React.useState(7); }`,
    `const React = require("react"); eval("React.useState = customHook"); const [seededTotal] = React.useState(7);`,
    `require = customLoader; const React = require("react"); const [seededTotal] = React.useState(7);`,
    `require.cache[require.resolve("react")] = {exports: customProvider}; const React = require("react"); const [seededTotal] = React.useState(7);`,
    `const loader = require; const React = require("react"); const [seededTotal] = React.useState(7);`,
    `install(require); const React = require("react"); const [seededTotal] = React.useState(7);`,
    `require(moduleName); const React = require("react"); const [seededTotal] = React.useState(7);`,
    `({loader: require} = loaders); const React = require("react"); const [seededTotal] = React.useState(7);`,
    `for (require of loaders) {} const React = require("react"); const [seededTotal] = React.useState(7);`,
  ])("keeps dynamic loader/provider scope unsupported: %s", (code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `module.require("react").useState = customHook;`,
    `module["require"]("react").useState = customHook;`,
    `module.parent.require("react").useState = customHook;`,
    `const Module = require("module"); Module._load("react", module).useState = customHook;`,
    `const Module = require("node:module"); const loader = Module.createRequire(__filename); loader("react").useState = customHook;`,
    `const {createRequire} = require("module"); const loader = createRequire(__filename); loader("react").useState = customHook;`,
    `process.mainModule.require("react").useState = customHook;`,
    `process.getBuiltinModule("module")._load("react", module).useState = customHook;`,
  ])("keeps visible native loader exposure unsupported: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${exposure} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("keeps a second imported native loader unsupported", () => {
    const result = runRule(
      hookUseState,
      `import React from "react"; import {createRequire} from "node:module"; const loader = createRequire(import.meta.url); loader("react").useState = customHook; const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const mode = process.env.NODE_ENV;`,
    `const module = {require: () => ({})}; module.require("other");`,
    `const process = {mainModule: {require: () => ({})}}; process.mainModule.require("other");`,
  ])("preserves harmless process metadata and unrelated shadowed loaders: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${metadata} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `globalThis.eval('process.mainModule.require("react").useState = customHook');`,
    `Function('process.mainModule.require("react").useState = customHook')();`,
    `globalThis.Function('process.mainModule.require("react").useState = customHook')();`,
    `const execute = (() => {}).constructor; execute('process.mainModule.require("react").useState = customHook')();`,
    `const constructorKey = "constructor"; const execute = (() => {})[constructorKey]; execute('process.mainModule.require("react").useState = customHook')();`,
    `const {constructor: execute} = () => {}; execute('process.mainModule.require("react").useState = customHook')();`,
  ])("keeps dynamic provider execution unsupported: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${exposure} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const description = handler.constructor.name;`,
    `const argumentCount = handler.constructor.length;`,
  ])("allows immediate readonly constructor metadata: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${metadata} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `handler.constructor('process.mainModule.require("react").useState = customHook')();`,
    `handler.constructor.bind(null)('process.mainModule.require("react").useState = customHook')();`,
    `handler.constructor.name();`,
    `handler.constructor.length = customHook;`,
  ])("keeps callable or writable constructor exposure unsupported: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${exposure} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("preserves an unrelated shadowed Function binding", () => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); const Function = () => () => null; Function("metadata")(); const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `const execute = Reflect.get(() => {}, "constructor"); execute('process.mainModule.require("react").useState = customHook')();`,
    `const execute = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value; execute('process.mainModule.require("react").useState = customHook')();`,
    `const key = "process"; globalThis[key].mainModule.require("react").useState = customHook;`,
    `const key = "require"; globalThis[key]("react").useState = customHook;`,
    `const key = "Function"; globalThis[key]('process.mainModule.require("react").useState = customHook')();`,
    `const key = "eval"; globalThis[key]('process.mainModule.require("react").useState = customHook');`,
    `const getKey = () => "constructor"; const execute = (() => {})[getKey()]; execute('process.mainModule.require("react").useState = customHook')();`,
    `const entries = {load: () => null}; const execute = entries[readKey()];`,
  ])("keeps reflection and unknown computed exposure unsupported: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${exposure} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("keeps a dynamic module mutation before a later component invocation unsupported", () => {
    const result = runRule(
      hookUseState,
      `import React from "react"; const Panel = () => {const [seededTotal] = React.useState(7); return seededTotal;}; const initialize = async () => {const provider = await import("react"); provider.default.useState = customHook; return Panel();};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const Object = {getPrototypeOf: () => null}; Object.getPrototypeOf("metadata");`,
    `const Reflect = {get: () => null}; Reflect.get("metadata");`,
    `const entries = [7]; const description = entries[0];`,
    `const key = "description"; const entries = {description: "stable"}; const description = entries[key];`,
  ])("allows shadowed reflection and static primitive keys: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${metadata} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `({[React.useState]: other} = source);`,
    `const getKey = () => "constructor"; const {[getKey()]: execute} = () => {}; execute('process.mainModule.require("react").useState = () => 7')();`,
  ])("keeps unresolved computed pattern exposure unsupported: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${exposure} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `const metadataKey = "description"; ({[metadataKey]: other} = source);`,
    `({"description": other = React.useState} = source);`,
  ])("allows known primitive pattern keys and default reads: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${metadata} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `declare const require: any; require("react").useState = customHook;`,
    `import type require = require("./types"); require("react").useState = customHook;`,
    `namespace require {} require("react").useState=customHook;`,
    `namespace require {export interface Loader {}} require("react").useState=customHook;`,
    `namespace require {type Loader=unknown;} require("react").useState=customHook;`,
    `namespace require {export namespace Shape {export interface Loader {}}} require("react").useState=customHook;`,
    `declare function require(source: string): any; require("react").useState = customHook;`,
    `interface Object {} Object.defineProperty(provider, "useState", {value: customHook});`,
    `type Reflect = unknown; Reflect.set(provider, "useState", customHook);`,
    `import type {Function} from "./types"; Function("replaceProvider()")();`,
    `import {type Object} from "./types"; Object.defineProperty(provider, "useState", {value: customHook});`,
    `import type Object = require("./types"); Object.defineProperty(provider, "useState", {value: customHook});`,
    `declare const globalThis: any; globalThis.require("react").useState = customHook;`,
    `declare const module: any; module.require("react").useState = customHook;`,
    `declare const process: any; process.mainModule.require("react").useState = customHook;`,
  ])("retains diagnostics through erased provider bindings: %s", (exposure) => {
    const result = runRule(
      hookUseState,
      `import {useState} from "react"; ${exposure} const [seededTotal] = useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `declare const require: any;`,
    `interface Object { description: string; }`,
    `type Reflect = unknown;`,
    `import type {Function} from "./types";`,
    `const require = () => ({}); require("metadata");`,
    `const require = () => ({useState: customHook}); interface require {} require("react").useState = customHook;`,
    `interface require {} const require = () => ({useState: customHook}); require("react").useState = customHook;`,
    `namespace require {export const provider={useState:customHook};} require.provider.useState=customHook;`,
    `function require(){return {useState:customHook};} namespace require {export interface Loader {}} require("react").useState=customHook;`,
    `namespace require {export const provider={useState:customHook};} namespace require {export interface Loader {}} require.provider.useState=customHook;`,
    `const Object = {defineProperty() {}}; interface Object {} Object.defineProperty(provider, "useState", {value: customHook});`,
  ])("allows unused erased declarations and real local loaders: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `import {useState} from "react"; ${metadata} const [seededTotal] = useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it("allows other ordinary literal CommonJS loads", () => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); const renderer = require("react-dom"); const widget = require("./widget"); const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `React.description = "stable";`,
    `({metadata: React.description} = source);`,
    `({callback: other = React.useState} = source);`,
  ])("allows CommonJS metadata and non-target reads: %s", (metadata) => {
    const result = runRule(
      hookUseState,
      `const React = require("react"); ${metadata} const [seededTotal] = React.useState(7);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
  it.each([
    `const [{item}] = useState(() => ({item: 7}));`,
    `const [[item]] = useState(() => [7]);`,
  ])("uses the explicit nested-value setting: %s", (declaration) => {
    const code = `import {useState} from "react"; ${declaration}`;
    expect(runRule(hookUseState, code).diagnostics).toHaveLength(1);
    expect(
      runRule(hookUseState, code, {
        settings: { "react-doctor": { hookUseState: { allowDestructuredState: true } } },
      }).diagnostics,
    ).toHaveLength(0);
  });
  it("still rejects writes to explicitly allowed nested bindings", () => {
    const result = runRule(
      hookUseState,
      `import {useState} from "react"; const [{item}] = useState(() => ({item: 7})); ({item} = source);`,
      { settings: { "react-doctor": { hookUseState: { allowDestructuredState: true } } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it.each([
    `import {useState} from "react"; const [seededTotal,,] = useState(7);`,
    `import {useState} from "react"; const [,setSeededTotal] = useState(7);`,
    `import {useState as retain} from "react"; const [seededTotal] = retain(7);`,
    `import {useState} from "react"; const useSeedTuple = () => useState(7);`,
  ])("preserves existing matcher and hole paths: %s", (code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
