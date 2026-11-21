import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

const cases = [
  {
    name: "imported-media-direct",
    source:
      "import {useEffect}from'react';import {useMediaQuery}from'../src/hooks/useMediaQuery';export function Panel({onChange}){const value=useMediaQuery('(max-width:600px)');useEffect(()=>{onChange(value)},[value,onChange]);return null}\n",
    expected: 0,
    filename: "controls/imported-media-direct.tsx",
  },
  {
    name: "imported-media-boolean-wrapper",
    source:
      "import {useEffect}from'react';import {useMediaQuery}from'../src/hooks/useMediaQuery';export function Panel({enabled,onChange}){const media=useMediaQuery('(max-width:600px)');const value=Boolean(enabled)&&media;useEffect(()=>{onChange(value)},[value,onChange]);return null}\n",
    expected: 0,
    filename: "controls/imported-media-boolean-wrapper.tsx",
  },
  {
    name: "direct-prop-conversion",
    source:
      "import{useEffect}from'react';export function Panel({value,onData}){useEffect(()=>{onData(Boolean(value))},[onData,value]);return null}\n",
    expected: 0,
    filename: "controls/direct-prop-conversion.tsx",
  },
  {
    name: "boolean-child-use-state-retain",
    source:
      "import{useEffect,useState}from'react';export function Panel({onData}){const[n,setN]=useState(0);useEffect(()=>{onData(Boolean(n))},[n,onData]);return <button onClick={()=>setN(n+1)}>{n}</button>}\n",
    expected: 1,
    filename: "controls/boolean-child-use-state-retain.tsx",
  },
  {
    name: "boolean-child-reducer-retain",
    source:
      "import{useEffect,useReducer}from'react';export function Panel({onData}){const[n,dispatch]=useReducer(n=>n+1,0);useEffect(()=>{onData(Boolean(n))},[n,onData]);return <button onClick={()=>dispatch()}>{n}</button>}\n",
    expected: 1,
    filename: "controls/boolean-child-reducer-retain.tsx",
  },
  {
    name: "opaque-child-hook-anchor-retain",
    source:
      "import{useEffect}from'react';export function Panel({onPendingChange}){const values=useSelectedValues();useEffect(()=>{onPendingChange(values)},[onPendingChange,values]);return null}\n",
    expected: 1,
    filename: "controls/opaque-child-hook-anchor-retain.tsx",
  },
  {
    name: "boolean-opaque-child-hook-retain",
    source:
      "import{useEffect}from'react';export function Panel({onPendingChange}){const values=useSelectedValues();useEffect(()=>{onPendingChange(Boolean(values))},[onPendingChange,values]);return null}\n",
    expected: 1,
    filename: "controls/boolean-opaque-child-hook-retain.tsx",
  },
  {
    name: "named-boolean-shadow-retain",
    source:
      "import{useEffect,useReducer}from'react';export function Panel({value,onData,Boolean}){const[n]=useReducer(n=>n+1,0);useEffect(()=>{onData(Boolean(value,n))},[onData,value,n,Boolean]);return null}\n",
    expected: 2,
    filename: "controls/named-boolean-shadow-retain.tsx",
  },
  {
    name: "literal-boolean-shadow-retain",
    source:
      "import{useEffect,useReducer}from'react';export function Panel({value,onData}){const[n]=useReducer(n=>n+1,0);const Boolean=()=>n;useEffect(()=>{onData(Boolean(value))},[onData,value,n]);return null}\n",
    expected: 1,
    filename: "controls/literal-boolean-shadow-retain.tsx",
  },
  {
    name: "boolean-local-reassignment-retain",
    source:
      "import{useEffect,useReducer}from'react';export function Panel({value,onData}){const[n]=useReducer(n=>n+1,0);let Boolean=globalThis.Boolean;Boolean=()=>n;useEffect(()=>{onData(Boolean(value))},[onData,value,n]);return null}\n",
    expected: 1,
    filename: "controls/boolean-local-reassignment-retain.tsx",
  },
  {
    name: "boolean-derived-argument-retain",
    source:
      "import{useEffect,useReducer}from'react';export function Panel({value,onData}){const[n]=useReducer(n=>n+1,0);useEffect(()=>{onData(Boolean(value+n))},[onData,value,n]);return null}\n",
    expected: 1,
    filename: "controls/boolean-derived-argument-retain.tsx",
  },
];

describe("no-pass-data-to-parent — Boolean parent-prop conversion", () => {
  it.each(cases)("$name", ({ source, expected, filename }) => {
    const result = runRule(noPassDataToParent, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
