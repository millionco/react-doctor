import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "genuine local value",
    code: 'const require = { note: 0 };require.note = 1;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "interface after genuine local value",
    code: 'const require = { note: 0 };interface require {}require.note = 1;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "interface before genuine local value",
    code: 'interface require {}const require = { note: 0 };require.note = 1;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: 'const require = { note: 0 };const inspectProvider = () => { interface require {} require.note = 1; };import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type require = require("provider-types");require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require {}",
    code: 'namespace require {}require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require { export interface Marker {} }",
    code: 'namespace require { export interface Marker {} }require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace require { export namespace Nested { export interface Marker {} } }",
    code: 'namespace require { export namespace Nested { export interface Marker {} } }require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
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
      const result = runRule(noRefCallbackCleanupBeforeReact19, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
