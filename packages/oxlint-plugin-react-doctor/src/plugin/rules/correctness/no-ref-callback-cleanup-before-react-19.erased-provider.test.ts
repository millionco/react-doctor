import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

const cases = [
  {
    name: "rejects erased global loader rewriting",
    code: 'declare const globalThis:any; globalThis.require("react").useCallback=()=>()=>undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "keeps an erased observer provider outside the native proof",
    code: 'declare const window:any; new window.ResizeObserver(()=>{});import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "preserves genuine local loader",
    code: 'const require = () => ({}); require("metadata");import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useCallback = () => () => undefined;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noRefCallbackCleanupBeforeReact19, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
