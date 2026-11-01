import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const cases = [
  {
    name: "rejects erased global carrier provider rewrite",
    code: 'declare const globalThis:any; globalThis.require("react").createRef=()=>({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "rejects erased global carrier alias rewrite",
    code: 'declare const globalThis:any; const world=globalThis; world.require("react").createRef=()=>({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "preserves genuine local loader",
    code: 'const require=()=>({}); require("metadata");import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noCreateRefInFunctionComponent, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
