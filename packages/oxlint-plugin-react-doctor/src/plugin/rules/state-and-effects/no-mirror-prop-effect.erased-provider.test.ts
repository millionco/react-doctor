import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useState = () => [0, () => {}];import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 0,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import {useState,useEffect} from "react"; export const Panel=({model})=>{const[draft,setDraft]=useState(model.value);useEffect(()=>{setDraft(model.value)},[model.value]);return <output>{draft}</output>};',
    expected: 1,
  },
  {
    name: "renamed direct prop: preserves an inert erased declaration",
    code: 'declare const require: any;import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "renamed direct prop: rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: 'renamed direct prop: rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "renamed direct prop: preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "renamed direct prop: rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useState = () => [0, () => {}];import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "renamed direct prop: preserves an inert empty namespace",
    code: 'namespace require {}import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "renamed direct prop: preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import React, {useState,useEffect,useLayoutEffect} from "react";  export const Panel = ({value, reset}) => { const [draft, writeDraft] = useState(value);  useEffect(()=>{writeDraft(value);},[value]); return <output>{draft}</output>; };',
    expected: 1,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noMirrorPropEffect, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
