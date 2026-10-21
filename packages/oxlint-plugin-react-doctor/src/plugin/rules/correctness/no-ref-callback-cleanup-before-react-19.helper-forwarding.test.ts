import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";
interface HelperCleanupCase {
  name: string;
  code: string;
  expectedDiagnostics: number;
  capabilities?: string[];
}
const cases: HelperCleanupCase[] = [
  {
    name: "three-roles-with-closed-native-ref-store",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "node-role-only-helper",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!node)return;return()=>reportSize(node);},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "direct-forwarded-helper-result",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{return track(node);},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "three-roles-reordered",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!window.ResizeObserver)return;if(!node)return;if(!reportSize)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "nested-observer-callback-and-local-update",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;const updateSize=()=>{reportSize(node);};updateSize();const resource=new window.ResizeObserver((entries)=>{const [entry]=entries;if(!entry)return;updateSize();});resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "literal-false-context-producer",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=false;const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "local-ref-current-guard",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const gate=useRef(false);const track=useCallback((node)=>{if(!gate.current)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "unadmitted-negated-true-prefix-falls-through",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!true)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "unconditional-return-before-cleanup",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{return;if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "null-helper-input",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(null);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "default-helper-parameter",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node=null)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "mutated-ref-callback-node",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{node=null;nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "conditional-function-valued-output",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return node?()=>resource.disconnect():undefined;},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "helper-returns-call-output",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return createStop(resource);},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "void-helper-result",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return;},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "async-helper",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback(async(node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "finally-overrides-cleanup",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;try{reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};}finally{return undefined;}},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "recursive-helper",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;track(node);reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "escaped-helper",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);install(track);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "mutable-result-binding",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;let stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "cleanup-called-before-return",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);stop?.();return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "helper-local-alias",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const alias=track;const bind=useCallback((node)=>{return alias(node);},[alias]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "context-literal-argument",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(false);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "context-destructure-default",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const {reportSize=false}=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "duplicate-node-role",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "shadowed-window-provider",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const window={ResizeObserver:undefined};const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "explicit-native-provider-replacement",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";window.ResizeObserver=undefined;export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "canonical-react-default-provider-exposure",
    code: 'import React,{useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";React.useCallback=customCallback;export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "type-only-usecallback-binding",
    code: 'import {type useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "react-require-hybrid-provider",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";const Provider=require("react");Provider.useCallback=customCallback;export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "escaped-native-ref-store",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);install(nodeRef);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "mutated-current-descriptor",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);Object.defineProperty(nodeRef,"current",{set(value){reportSize(value);}});const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "window-root-alias-escape",
    code: 'const nativeWindow=window;install(nativeWindow);import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "global-provider-replacement",
    code: 'globalThis.window={ResizeObserver:undefined};import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "window-root-assignment",
    code: 'window=replacementWindow;import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "reflective-native-constructor-exposure",
    code: 'Reflect.get(()=>{},"constructor")("window.ResizeObserver=undefined")();import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "unknown-computed-provider-transport",
    code: 'const nativeConstructor=(()=>{})[selectedKey];import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "type-only-react-namespace-does-not-replace-runtime",
    code: 'import type * as ReactTypes from "react";import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "runtime-typescript-wrappers",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=(track(node) as (()=>void)|undefined);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "native-current-read-as-call-argument",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);focusIfNeeded?.(nodeRef.current);return <td ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "react19-capability-gate",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
    capabilities: ["react", "react:18", "react:19"],
  },
  {
    name: "non-native-current-store",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef={current:null};const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "rest-ref-callback-parameter",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((...node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "destructured-helper-parameter",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback(({node})=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "bare-global-native-provider-replacement",
    code: 'import {useCallback} from "react";ResizeObserver=undefined;export const Panel=()=>{const track=useCallback((node)=>{if(!node)return;if(!window.ResizeObserver)return;return()=>node.removeAttribute("data-active");},[]);const bind=useCallback((node)=>{return track(node);},[track]);return <div ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "later-explicit-ref-overrides-callback",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind} ref={null}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "later-known-ref-spread-overrides-callback",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind} {...{ref:null}}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "later-unknown-spread-may-override-callback",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind} {...attributes}/>;};',
    expectedDiagnostics: 0,
  },
  {
    name: "earlier-unknown-spread-overridden-by-callback",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td {...attributes} ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "later-static-nonref-spread-preserves-callback",
    code: 'import {useCallback,useContext,useRef} from "react";import {DisplayContext} from "./display-context";export const Panel=()=>{const reportSize=useContext(DisplayContext);const nodeRef=useRef(null);const track=useCallback((node)=>{if(!reportSize)return;if(!node)return;if(!window.ResizeObserver)return;reportSize(node);const resource=new window.ResizeObserver(()=>reportSize(node));resource.observe(node);return()=>{resource.unobserve(node);resource.disconnect();};},[reportSize]);const bind=useCallback((node)=>{nodeRef.current=node;const stop=track(node);return stop;},[track]);return <td ref={bind} {...{id:"panel"}}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "noop-prologue-in-each-function-body",
    code: 'import {useCallback} from "react";export const Panel=()=>{void 0;const track=useCallback((node)=>{void 0;if(!node)return;return()=>node.removeAttribute("data-active");},[]);const bind=useCallback((node)=>{void 0;const cleanup=track(node);return cleanup;},[track]);return <div ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "literal-directive-and-empty-noop-statements",
    code: 'import {useCallback} from "react";export const Panel=()=>{const track=useCallback((node)=>{"local directive";;42;void 0;if(!node)return;return()=>node.removeAttribute("data-active");},[]);const bind=useCallback((node)=>{"local directive";;42;void 0;const cleanup=track(node);return cleanup;},[track]);return <div ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "noop-before-final-return-and-after-return",
    code: 'import {useCallback} from "react";export const Panel=()=>{const track=useCallback((node)=>{if(!node)return;void 0;return()=>node.removeAttribute("data-active");},[]);const bind=useCallback((node)=>{const cleanup=track(node);void 0;return cleanup;void 0;},[track]);return <div ref={bind}/>;};',
    expectedDiagnostics: 1,
  },
  {
    name: "effectful-outer-prologue-stays-unsupported",
    code: 'import {useCallback} from "react";export const Panel=()=>{const track=useCallback((node)=>{if(!node)return;return()=>node.removeAttribute("data-active");},[]);const bind=useCallback((node)=>{void updateNode(node);const cleanup=track(node);return cleanup;},[track]);return <div ref={bind}/>;};',
    expectedDiagnostics: 0,
  },
];
describe("no-ref-callback-cleanup local helper forwarding", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noRefCallbackCleanupBeforeReact19, testCase.code, {
        filename: "src/panel.tsx",
        settings: {
          "react-doctor": {
            portedRuleMode: "curated",
            capabilities: testCase.capabilities ?? ["react", "react:18"],
          },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedDiagnostics);
    });
  }
});
