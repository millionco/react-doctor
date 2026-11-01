import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "genuine local value",
    code: 'const require = { note: 0 };require.note = 1;import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "interface after genuine local value",
    code: 'const require = { note: 0 };interface require {}require.note = 1;import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "interface before genuine local value",
    code: 'interface require {}const require = { note: 0 };require.note = 1;import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: 'const require = { note: 0 };const inspectProvider = () => { interface require {} require.note = 1; };import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 1,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type require = require("provider-types");require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require {}",
    code: 'namespace require {}require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require { export interface Marker {} }",
    code: 'namespace require { export interface Marker {} }require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require { export namespace Nested { export interface Marker {} } }",
    code: 'namespace require { export namespace Nested { export interface Marker {} } }require("react").createRef = () => ({current:null});import * as React from "react";import {createRef,useEffect,useRef,useState}from"react";export const Panel=({active})=>{const refs=useRef([]);const makeRef=()=>{const ref=createRef();refs.current.push(ref);return ref;};const renderItem=()=> <div ref={makeRef()}/>;return active?renderItem():null;};',
    expected: 0,
  },
];
const options = {
  filename: "src/binding-forms.tsx",
  forceJsx: true,
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noCreateRefInFunctionComponent, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
