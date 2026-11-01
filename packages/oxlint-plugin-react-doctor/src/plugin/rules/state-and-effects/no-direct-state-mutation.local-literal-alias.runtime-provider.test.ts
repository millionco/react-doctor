import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const cases = [
  {
    name: "runtime-provider-unmasked",
    code: 'import React,{useState}from"react";function expose(){consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-provider-interface",
    code: 'import React,{useState}from"react";function expose(){interface React{};consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-provider-type-alias",
    code: 'import React,{useState}from"react";function expose(){type React=unknown;consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "initializer-escape-interface",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function expose(){interface initial{};consume(initial);}expose();snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "initializer-escape-type-alias",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function expose(){type initial=unknown;consume(initial);}expose();snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "state-write-interface",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function update(){interface snapshot{};snapshot.count=1;}update();return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "state-write-type-alias",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function update(){type snapshot=unknown;snapshot.count=1;}update();return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "runtime-loader-unmasked",
    code: 'import{useState}from"react";require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-ambient",
    code: 'import{useState}from"react";declare const require:any;require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-interface",
    code: 'import{useState}from"react";interface require{};require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-type-alias",
    code: 'import{useState}from"react";type require=unknown;require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-type-import",
    code: 'import{useState}from"react";import type{require}from"./external";require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "runtime-loader-type-import-equals",
    code: 'import{useState}from"react";import type require = require("node:module");require("react").useState=replacement;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "dynamic-provider-exposure",
    code: 'import{useState}from"react";import("react").then(provider=>consume(provider));export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "local-loader-interface",
    code: 'import{useState}from"react";function local(){const require=()=>({useState:()=>[]});interface require{};require("react").useState=replacement;}export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "outer-local-loader-interface",
    code: 'import{useState}from"react";function local(){const require=()=>({useState:()=>[]});function nested(){interface require{};require("react").useState=replacement;}nested();}export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "ambient-loader-inert",
    code: 'import{useState}from"react";declare const require:any;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "real-provider-local-interface",
    code: 'import React,{useState}from"react";function local(){const React={};interface React{};consume(React);}export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "real-initializer-local-interface",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function local(){const initial={};interface initial{};consume(initial);}snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "real-state-local-interface",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);function local(){const snapshot={count:0};interface snapshot{};snapshot.count=1;}return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "named-hook-inner-interface-escape",
    code: 'import{useState}from"react";function expose(){interface useState{};consume(useState);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "initial-binding-destructure-write",
    code: 'import{useState}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);({initial}=replacement);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "type-only-provider-namespace-runtime",
    code: 'import{useState}from"react";import type*as React from"react";function expose(){interface React{};consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "type-only-provider-namespace-inert",
    code: 'import{useState}from"react";import type*as React from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-default-runtime",
    code: 'import{useState}from"react";import type React from"react";function expose(){interface React{};consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "type-only-provider-default-inert",
    code: 'import{useState}from"react";import type React from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-named-runtime",
    code: 'import{useState}from"react";import type{useState as React}from"react";function expose(){interface React{};consume(React);}expose();export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 0,
  },
  {
    name: "type-only-provider-named-inert",
    code: 'import{useState}from"react";import type{useState as React}from"react";export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-real-shadow",
    code: 'import{useState}from"react";import type*as React from"react";function local(){const React={};interface React{};consume(React);}export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-real-outer-shadow",
    code: 'import{useState}from"react";import type*as React from"react";function local(){const React={};function nested(){interface React{};consume(React);}nested();}export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-type-query",
    code: 'import{useState}from"react";import type*as React from"react";type Carrier=typeof React;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "type-only-provider-unrelated-property",
    code: 'import{useState}from"react";import type*as React from"react";const object={React:1};void object.React;export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
  {
    name: "same-scope-merged-hook",
    code: 'import{useState}from"react";interface useState{};export const Panel=()=>{const initial={count:0};const[snapshot,setSnapshot]=useState(initial);snapshot.count=1;return <output/>;};',
    expectedCount: 1,
  },
];

describe("local literal state runtime provider proof", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noDirectStateMutation, code, {});
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
