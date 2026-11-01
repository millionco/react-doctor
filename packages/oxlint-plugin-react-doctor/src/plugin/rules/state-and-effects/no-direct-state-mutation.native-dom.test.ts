import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

interface NativeDomWriteCase {
  name: string;
  code: string;
  expected: number;
}

const cases: ReadonlyArray<NativeDomWriteCase> = [
  {
    name: "type-only-namespace-provider",
    code: 'namespace Document {export namespace Shape {export interface Marker {}}}\nDocument.prototype.getElementById=customLookup;\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "empty-namespace-provider",
    code: 'namespace Document {}\nDocument.prototype.getElementById=customLookup;\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "runtime-namespace-provider",
    code: 'namespace Document {export const prototype={getElementById:customLookup};}\nDocument.prototype.getElementById=customLookup;\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "type-import-equals-provider",
    code: 'import type Document = require("./types");Document.prototype.getElementById=customLookup;\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "local-interface-provider",
    code: 'class Document {getElementById(){}}interface Document {}Document.prototype.getElementById=customLookup;\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "erased-interface-provider",
    code: 'import {useEffect,useState} from "react";interface Document {} Document.prototype.getElementById=customLookup;export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "erased-ambient-provider",
    code: 'import {useEffect,useState} from "react";declare const Document: any;Document.prototype.getElementById=customLookup;export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "type-only-import-provider",
    code: 'import {useEffect,useState} from "react";import type {Document} from "./types";Document.prototype.getElementById=customLookup;export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "inert-interface-provider",
    code: 'import {useEffect,useState} from "react";interface Document {}export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "real-local-constructor-provider",
    code: 'import {useEffect,useState} from "react";class Document {} Document.prototype.localMetadata="stable";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "native-direct-lookup-alias",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "native-readonly-local-chain",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");const sameNode=node;if(node)setHost(sameNode);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "native-type-annotation-not-origin",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState<HTMLElement|null>(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "known-null-reset",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);setHost(null);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "native-other-string-style-value",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="auto";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "shadowed-global-object-is-not-native-exposure",
    code: 'import {useEffect,useState} from "react";const window={local:true};window.local=false;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "plain-mixed-feed",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);setHost({style:{pointerEvents:"none"}});},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "unknown-mixed-feed",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);setHost(value);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "array-mixed-feed",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);setHost([]);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "lookup-method-replaced-before",
    code: 'import {useEffect,useState} from "react";document.getElementById=customLookup;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "lookup-method-replaced-after",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);document.getElementById=customLookup;return <div/>;};',
    expected: 1,
  },
  {
    name: "native-document-binding-replaced",
    code: 'import {useEffect,useState} from "react";document=customDocument;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "global-document-projection-write",
    code: 'import {useEffect,useState} from "react";globalThis.document=customDocument;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "global-object-alias-write",
    code: 'import {useEffect,useState} from "react";const root=globalThis;root.document=customDocument;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "document-object-alias-write",
    code: 'import {useEffect,useState} from "react";const receiver=document;receiver.getElementById=customLookup;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "document-prototype-write",
    code: 'import {useEffect,useState} from "react";Document.prototype.getElementById=customLookup;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "style-prototype-write",
    code: 'import {useEffect,useState} from "react";HTMLElement.prototype.style={pointerEvents:"none"};export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "document-object-escape",
    code: 'import {useEffect,useState} from "react";install(document);export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "lookup-method-escape",
    code: 'import {useEffect,useState} from "react";install(document.getElementById);export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "reflection-provider-write",
    code: 'import {useEffect,useState} from "react";Reflect.set(document,"getElementById",customLookup);export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "object-descriptor-provider-write",
    code: 'import {useEffect,useState} from "react";Object.defineProperty(document,"getElementById",{value:customLookup});export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "shadowed-document",
    code: 'import {useEffect,useState} from "react";const document={getElementById:()=>({style:{pointerEvents:"none"}})};export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "computed-lookup-method",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document["getElementById"]("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "optional-lookup-method",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById?.("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "unknown-selector",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById(value);if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "member-factory-is-not-native-lookup",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=value.lookup();if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "extracted-lookup-method",
    code: 'import {useEffect,useState} from "react";const lookup=document.getElementById;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=lookup("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "mutable-result-alias",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");let alias=node;alias={style:{pointerEvents:"none"}};if(node)setHost(alias);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "const-binding-pattern-replacement",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");[node]=[value];if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "lookup-result-opaque-escape",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");install(node);if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "host-state-opaque-escape",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);install(host);return <div/>;};',
    expected: 1,
  },
  {
    name: "setter-opaque-escape",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);install(setHost);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "setter-function-alias",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);const write=setHost;write(value);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "combined-ref-feed-held",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);useCombinedRefs(setHost);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "intervening-await",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(async()=>{const node=document.getElementById("panel-host");await wait();if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "plain-host-expando-data",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");node.payload={count:0};if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.payload.count=value;},[host]);return <output>{host?.payload.count}</output>;return <div/>;};',
    expected: 1,
  },
  {
    name: "other-dom-field-unsupported",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.customValue=value;},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "other-style-property-unsupported",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.visibility="hidden";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "native-react-provider-replaced",
    code: 'import {useEffect,useState} from "react";import React from "react";React.useState=customState;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "native-effect-provider-replaced",
    code: 'import {useEffect,useState} from "react";import React from "react";React.useEffect=customEffect;export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "type-only-react",
    code: 'import type {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "custom-react-provider",
    code: 'import {useEffect,useState} from "custom-ui";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "direct-owner-document-provider-replaced",
    code: 'document.getElementById("panel-host").ownerDocument.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "alias-owner-document-provider-replaced",
    code: 'const otherHost=document.getElementById("panel-host");otherHost.ownerDocument.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "other-native-lookup-opaque-escape",
    code: 'install(document.getElementById("other-host"));import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "unused-other-native-lookup",
    code: 'const unrelated=document.getElementById("other-host");import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "unused-direct-native-lookup",
    code: 'document.getElementById("other-host");import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "other-native-lookup-truthiness-only",
    code: 'const unrelated=document.getElementById("other-host");if(unrelated)notify();import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "unrelated-state-lookup-unknown-use",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);const[other,setOther]=useState(null);const unrelated=document.getElementById("other-host");setOther(unrelated);install(other);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "lookup-result-provider-projection",
    code: 'document.getElementById("other-host").ownerDocument.defaultView.document=customDocument;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "htmldocument-direct-prototype-replacement",
    code: 'HTMLDocument.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "htmldocument-readonly-alias-replacement",
    code: 'const Provider=HTMLDocument;Provider.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "htmldocument-static-computed-replacement",
    code: 'HTMLDocument["prototype"]["getElementById"]=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "htmldocument-type-position",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState<HTMLDocument|null>(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "htmldocument-local-shadow",
    code: 'const HTMLDocument={prototype:{}};HTMLDocument.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "xmldocument-direct-prototype-replacement",
    code: 'XMLDocument.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "xmldocument-readonly-alias-replacement",
    code: 'const Provider=XMLDocument;Provider.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "xmldocument-static-computed-replacement",
    code: 'XMLDocument["prototype"]["getElementById"]=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "xmldocument-type-position",
    code: 'import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState<XMLDocument|null>(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "xmldocument-local-shadow",
    code: 'const XMLDocument={prototype:{}};XMLDocument.prototype.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "ownerDocument-direct-unsupported-carrier",
    code: 'const provider=element.ownerDocument;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "ownerDocument-static-computed-unsupported-carrier",
    code: 'const provider=element["ownerDocument"];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "ownerDocument-const-key-unsupported-carrier",
    code: 'const carrierKey="ownerDocument";const provider=element[carrierKey];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "ownerDocument-destructure-unsupported-carrier",
    code: 'const {ownerDocument:provider}=element;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "getRootNode-direct-unsupported-carrier",
    code: 'const provider=element.getRootNode;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "getRootNode-static-computed-unsupported-carrier",
    code: 'const provider=element["getRootNode"];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "getRootNode-const-key-unsupported-carrier",
    code: 'const carrierKey="getRootNode";const provider=element[carrierKey];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "getRootNode-destructure-unsupported-carrier",
    code: 'const {getRootNode:provider}=element;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "parentNode-direct-unsupported-carrier",
    code: 'const provider=element.parentNode;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "parentNode-static-computed-unsupported-carrier",
    code: 'const provider=element["parentNode"];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "parentNode-const-key-unsupported-carrier",
    code: 'const carrierKey="parentNode";const provider=element[carrierKey];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "parentNode-destructure-unsupported-carrier",
    code: 'const {parentNode:provider}=element;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "native-image-owner-document-provider-write",
    code: 'new Image().ownerDocument.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "intrinsic-ref-owner-document-provider-write",
    code: 'import {createRoot} from "react-dom/client";createRoot(container).render(<div ref={(node)=>{if(node)node.ownerDocument.getElementById=customLookup;}}/>);import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "shadowed-image-owner-document-carrier-unsupported",
    code: 'const Image=()=>({ownerDocument:{getElementById:()=>null}});Image().ownerDocument.getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
  {
    name: "owner-document-type-position",
    code: 'interface HostInfo {ownerDocument:Document;getRootNode:()=>Document;parentNode:Node};import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "document-carrier-indexed-type-position",
    code: 'type HostDocument=HTMLElement["ownerDocument"];import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 0,
  },
  {
    name: "unknown-computed-native-document-carrier-unsupported",
    code: 'new Image()[unknownKey].getElementById=customLookup;import {useEffect,useState} from "react";export const Panel=({value})=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("panel-host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};',
    expected: 1,
  },
];

describe("native DOM pointer-events state writes", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noDirectStateMutation, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
