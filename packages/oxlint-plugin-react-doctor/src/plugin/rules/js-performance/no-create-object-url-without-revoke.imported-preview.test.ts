import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

interface ImportedPreviewCase {
  readonly name: string;
  readonly producer?: string;
  readonly caller?: string;
  readonly expectedWarnings: number;
  readonly extraFiles?: Readonly<Record<string, string>>;
}

const producer =
  'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n';
const caller =
  'import {show} from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n';
const cases: readonly ImportedPreviewCase[] = [
  {
    name: "plain-img-own-src",
    expectedWarnings: 1,
  },
  {
    name: "plain-video-controls",
    producer:
      'export const show = (source, theme) => <video controls src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 1,
  },
  {
    name: "conditional-value-branch",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{file ? show(URL.createObjectURL(file),theme) : null}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "logical-right-value",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{file && show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "default-import-pure-function",
    producer:
      'const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\nexport default show;\n',
    caller:
      'import show from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "default-parameter-unsupported",
    producer:
      'export const show = (source = "fallback", theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "rest-parameter-unsupported",
    producer: "export const show = (...args) => <img src={args[0]} />;\n",
    expectedWarnings: 0,
  },
  {
    name: "wrong-argument-position",
    producer: "export const show = (theme,source) => <img src={source} />;\n",
    expectedWarnings: 0,
  },
  {
    name: "local-alias-callee-unsupported",
    caller:
      'import {show} from "./preview"; const render=show; export const View = ({file,theme}) => <div>{render(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "namespace-member-callee-unsupported",
    caller:
      'import * as preview from "./preview"; export const View = ({file,theme}) => <div>{preview.show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "call-transport-unsupported",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{show.call(null,URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "spread-arguments-unsupported",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{show(...[URL.createObjectURL(file),theme])}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "source-override-duplicate",
    producer:
      'export const show = (source, theme) => <img src={source} src="ordinary.png" alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "source-spread-override",
    producer:
      'export const show = (source, theme) => <img src={source} {...theme} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "helper-own-cleanup",
    producer:
      "export const show=(source,theme)=>{ URL.revokeObjectURL(source); return <img src={source}/>; };\n",
    expectedWarnings: 0,
  },
  {
    name: "helper-inline-cleanup",
    producer:
      "export const show=(source,theme)=><img src={(URL.revokeObjectURL(source),source)}/>;\n",
    expectedWarnings: 0,
  },
  {
    name: "custom-host-unsupported",
    producer:
      'export const show = (source, theme) => <ManagedPreview src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "event-owner-unsupported",
    producer:
      'export const show = (source, theme) => <img src={source} onLoad={()=>URL.revokeObjectURL(source)} style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "ref-owner-unsupported",
    producer:
      'export const show = (source, theme) => <img src={source} ref={theme} style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "selected-param-opaque-second-read",
    producer:
      'export const show = (source, theme) => <img src={source} title={source} style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "getter-or-member-other-attr",
    producer:
      'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme.filter}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "direct-other-param-coercion",
    producer:
      'export const show = (source, theme) => <img src={source} title={theme} style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "module-eval-rebind",
    producer:
      'export function show(source,theme){return <img src={source}/>;}\neval("show = source => { URL.revokeObjectURL(source); return null; }");\n',
    expectedWarnings: 0,
  },
  {
    name: "module-visible-url-replacement",
    producer:
      'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\nURL.createObjectURL = file => "ordinary.png";\n',
    expectedWarnings: 0,
  },
  {
    name: "module-runtime-import-even-unrelated",
    producer:
      'import "./setup";\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "reexport-even-unique-unsupported",
    producer: 'export {show} from "./actual";\n',
    expectedWarnings: 0,
  },
  {
    name: "reexport-ambiguous-unsupported",
    producer: 'export * from "./first"; export * from "./second";\n',
    expectedWarnings: 0,
  },
  {
    name: "jsx-factory-pragma-unsupported",
    producer:
      '/** @jsx cleanupFactory */\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "stored-element-cleanup",
    caller:
      'import {show} from "./preview"; const element=show(URL.createObjectURL(file),false); URL.revokeObjectURL(element.props.src); export const View=()=> <div>{element}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "custom-child-owner-cleanup",
    caller:
      'import {show} from "./preview"; const Managed=({children})=>{URL.revokeObjectURL(children.props.src);return children;}; export const View=({file})=><Managed>{show(URL.createObjectURL(file),false)}</Managed>;\n',
    expectedWarnings: 0,
  },
  {
    name: "logical-left-discarded-element",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme) && null}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "opaque-element-member-result",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme).props.src}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "renamed-import-binding",
    caller:
      'import {show as renderPreview} from "./preview"; export const View = ({file,theme}) => <div>{renderPreview(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "named-function-declaration",
    producer: 'export function show(source,theme){ return <img src={source} alt="preview"/>; }',
    expectedWarnings: 1,
  },
  {
    name: "anonymous-default-function",
    producer: "export default function(source,theme){ return <img src={source}/>; }",
    caller:
      'import show from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "anonymous-default-arrow",
    producer: "export default (source,theme)=><img src={source}/>;",
    caller:
      'import show from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 1,
  },
  {
    name: "multiple-passive-preview-exports",
    producer:
      'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\nexport const video = (url)=><video controls src={url}/>;',
    expectedWarnings: 1,
  },
  {
    name: "export-rebinding-refused",
    producer:
      'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\nshow = replacement;',
    expectedWarnings: 0,
  },
  {
    name: "mutable-export-refused",
    producer:
      'export let show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "parameter-shadowing-import",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme,show}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "type-only-import",
    caller:
      'import type {show} from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "inline-type-import-is-runtime-module-edge",
    producer:
      'import {type Marker} from "./setup";\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
    extraFiles: {
      "src/setup.ts": "export interface Marker {}",
    },
  },
  {
    name: "erased-type-declaration-import",
    producer:
      'import type {Marker} from "./setup";\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 1,
    extraFiles: {
      "src/setup.ts": "export interface Marker {}",
    },
  },
  {
    name: "use-server-directive-refused",
    producer:
      '"use server";\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 0,
  },
  {
    name: "use-client-directive-passive",
    producer:
      '"use client";\nexport const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
    expectedWarnings: 1,
  },
  {
    name: "own-src-getter-shape-refused",
    producer:
      "export const show=(source,theme)=><img {...{get src(){URL.revokeObjectURL(source);return source;}}}/>;",
    expectedWarnings: 0,
  },
  {
    name: "outer-native-ref-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div ref={node=>node&&URL.revokeObjectURL(node.querySelector("img").src)}>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-nested-native-ref-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div ref={release}><span>{show(URL.createObjectURL(file),theme)}</span></div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-nested-custom-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <Managed><div>{show(URL.createObjectURL(file),theme)}</div></Managed>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-custom-native-tag",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <managed-preview>{show(URL.createObjectURL(file),theme)}</managed-preview>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-native-owner-spread",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div {...owner}>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-native-is-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div is="managed-preview">{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-native-event-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div onClick={release}>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "outer-dangerous-content-owner",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => <div dangerouslySetInnerHTML={owner}>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "saved-native-jsx-explicit-cleanup",
    caller:
      'import {show} from "./preview"; import {useEffect} from "react"; export const View=({file})=>{const element=<div>{show(URL.createObjectURL(file),false)}</div>;useEffect(()=>()=>URL.revokeObjectURL(element.props.children.props.src),[element]);return element;};',
    expectedWarnings: 0,
  },
  {
    name: "unknown-jsx-return-carrier",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => manage(<div>{show(URL.createObjectURL(file),theme)}</div>);\n',
    expectedWarnings: 0,
  },
  {
    name: "deferred-unknown-callback",
    caller:
      'import {show} from "./preview"; export const View = ({file,theme}) => schedule(()=> <div>{show(URL.createObjectURL(file),theme)}</div>);\n',
    expectedWarnings: 0,
  },
  {
    name: "unknown-custom-map-receiver",
    caller:
      'import {show} from "./preview"; export const View=({items})=><div>{items.map(file=><span>{show(URL.createObjectURL(file),false)}</span>)}</div>;',
    expectedWarnings: 0,
  },
  {
    name: "native-literal-map",
    caller:
      'import {show} from "./preview"; export const View=({file})=><div>{[file].map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;',
    expectedWarnings: 1,
  },
  {
    name: "visible--babelrc-refused",
    expectedWarnings: 0,
    extraFiles: {
      ".babelrc": "{}",
    },
  },
  {
    name: "visible-babel-config-cjs-refused",
    expectedWarnings: 0,
    extraFiles: {
      "babel.config.cjs": "{}",
    },
  },
  {
    name: "visible-tsconfig-json-refused",
    expectedWarnings: 0,
    extraFiles: {
      "tsconfig.json": "{}",
    },
  },
  {
    name: "visible-jsconfig-json-refused",
    expectedWarnings: 0,
    extraFiles: {
      "jsconfig.json": "{}",
    },
  },
  {
    name: "helper-own-subdirectory-configuration",
    caller:
      'import {show} from "./nested/preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
    extraFiles: {
      "src/nested/preview.tsx":
        'export const show = (source, theme) => <img src={source} alt="preview" style={{filter:theme?"invert(1)":"invert(0)"}} />;\n',
      "src/nested/tsconfig.json": "{}",
    },
  },
  {
    name: "caller-jsx-pragma",
    caller:
      '/** @jsx cleanupFactory */\nimport {show} from "./preview"; export const View = ({file,theme}) => <div>{show(URL.createObjectURL(file),theme)}</div>;\n',
    expectedWarnings: 0,
  },
  {
    name: "native-array-state-append",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 1,
  },
  {
    name: "native-array-state-initially-populated",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]);  return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 1,
  },
  {
    name: "state-array-local-copy-splice-payload",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>{const next=[...files,file]; next.splice(0,0); setFiles(next);}; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 1,
  },
  {
    name: "never-written-empty-array-state",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]);  return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "all-empty-array-state-writers",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([]); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "functional-array-state-writer-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles(previous=>[...previous,file]); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "unknown-array-state-writer-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles(loadFiles()); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "escaped-array-setter-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); expose(setFiles); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-state-binding-rebound",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); [files]=replacement; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-state-setter-rebound",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); [setFiles]=replacement; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "state-map-member-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); files.map=managedMap; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "state-map-alias-member-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); const alias=files; alias.map=managedMap; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-payload-map-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>{const next=[...files,file]; next.map=managedMap; setFiles(next);}; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-map-object-descriptor-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); Object.defineProperty(files,"map",{value:managedMap}); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-map-reflect-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); Reflect.set(files,"map",managedMap); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-prototype-map-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); Array.prototype.map=managedMap; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-prototype-alias-map-replacement",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); const prototype=Array.prototype; prototype.map=managedMap; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "array-native-data-read-kept",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); Object.keys({kind:"preview"}); return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 1,
  },
  {
    name: "array-state-opaque-value-consumer-premise",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); const upload=()=>{setFiles([]); sendFiles(files);}; return <><button onClick={append}>Add</button><div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div></>;};',
    expectedWarnings: 1,
  },
  {
    name: "returned-whole-shell-cleanup-refused",
    caller:
      'import {show} from "./preview"; import {useEffect} from "react"; export const View=({file})=>{let element; element=<section><div>{show(URL.createObjectURL(file),false)}</div></section>; useEffect(()=>()=>URL.revokeObjectURL(element.props.children.props.children.props.src),[element]);return element;};',
    expectedWarnings: 0,
  },
  {
    name: "map-result-saved-shell-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const append=()=>setFiles([...files,file]); const shells=files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>); return <><button onClick={append}>Add</button><div>{shells}</div></>;};',
    expectedWarnings: 0,
  },
  {
    name: "local-parameter-array-map-mutation-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const corrupt=list=>{list.map=callback=>{const element=callback(file);URL.revokeObjectURL(element.props.children.props.src);return [element];};}; corrupt(files); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "literal-array-local-parameter-map-mutation-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const files=[file]; const corrupt=list=>{list.map=callback=>{const element=callback(file);URL.revokeObjectURL(element.props.children.props.src);return [element];};}; corrupt(files); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "destructured-array-prototype-map-mutation-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const {prototype}=Array;prototype.map=managedMap; return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "dynamic-member-mutation-refused",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const corrupt=list=>{list[key]=managedMap;};corrupt(files); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "hook-returned-jsx-cleanup-refused",
    caller:
      'import {show} from "./preview";import {useEffect} from "react";const usePreview=file=><div>{show(URL.createObjectURL(file),false)}</div>;export const View=({file})=>{const element=usePreview(file);useEffect(()=>()=>URL.revokeObjectURL(element.props.children.props.src),[element]);return element;};',
    expectedWarnings: 0,
  },
  {
    name: "raw-object-mutation-alias",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const define=Object.defineProperty;define(files,"map",{value:managedMap}); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "destructured-object-prototype-capability",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const {setPrototypeOf}=Object;setPrototypeOf(files,{map:managedMap}); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "destructured-reflect-capability",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); const {set}=Reflect;set(files,"map",managedMap); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "erased-object-binding-capability",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([file]); interface Object {} const {setPrototypeOf}=Object;setPrototypeOf(files,{map:managedMap}); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "empty-state-self-spread-only-writer",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const copy=()=>setFiles([...files]); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "hole-only-direct-array",
    caller:
      'import {show} from "./preview";export const View=({file})=><div>{[,,].map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;',
    expectedWarnings: 0,
  },
  {
    name: "readonly-empty-array-spread-only-writer",
    caller:
      'import {show} from "./preview"; import {useState} from "react"; export const View=({file})=>{const [files,setFiles]=useState([]); const empty=[]; const copy=()=>setFiles([...empty]); return <div>{files.map(item=><span>{show(URL.createObjectURL(item),false)}</span>)}</div>;};',
    expectedWarnings: 0,
  },
  {
    name: "additional-babel-config-babel.config.json",
    expectedWarnings: 0,
    extraFiles: {
      "babel.config.json": "{}",
    },
  },
  {
    name: "additional-babel-config-.babelrc.mjs",
    expectedWarnings: 0,
    extraFiles: {
      ".babelrc.mjs": "{}",
    },
  },
  {
    name: "additional-babel-config-babel.config.cts",
    expectedWarnings: 0,
    extraFiles: {
      "babel.config.cts": "{}",
    },
  },
  {
    name: "additional-babel-config-babel.config.mts",
    expectedWarnings: 0,
    extraFiles: {
      "babel.config.mts": "{}",
    },
  },
  {
    name: "additional-babel-config-.babelrc.cts",
    expectedWarnings: 0,
    extraFiles: {
      ".babelrc.cts": "{}",
    },
  },
  {
    name: "additional-babel-config-.babelrc.ts",
    expectedWarnings: 0,
    extraFiles: {
      ".babelrc.ts": "{}",
    },
  },
  {
    name: "additional-babel-config-.babelrc.mts",
    expectedWarnings: 0,
    extraFiles: {
      ".babelrc.mts": "{}",
    },
  },
];
let temporaryDirectory = "";
const manifest = { private: true, type: "module", dependencies: { react: "19.2.0" } };
const writeFixture = (relativePath: string, code: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, code);
  return filename;
};
const writeProject = (testCase: ImportedPreviewCase): string => {
  writeFixture("package.json", JSON.stringify(manifest));
  writeFixture("src/preview.tsx", testCase.producer ?? producer);
  const filename = writeFixture("src/app.tsx", testCase.caller ?? caller);
  for (const [relativePath, code] of Object.entries(testCase.extraFiles ?? {}))
    writeFixture(relativePath, code);
  return filename;
};
const inspect = (filename: string) =>
  runRule(noCreateObjectUrlWithoutRevoke, fs.readFileSync(filename, "utf8"), {
    filename,
    settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
  });
const collect = (filename: string) =>
  collectCrossFileDependencyProbes({
    absoluteFilePath: filename,
    sourceText: fs.readFileSync(filename, "utf8"),
    ruleIds: ["no-create-object-url-without-revoke"],
  });
beforeEach(() => {
  temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "imported-preview-")));
  resetFilesystemCaches();
});
afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("imported passive native previews", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const filename = writeProject(testCase);
      const result = inspect(filename);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedWarnings);
    });
  }
  it.each(["19.2.0", "^19.2.0", "~19.2.0"])(
    "accepts the declared ordinary React version %s",
    (version) => {
      const filename = writeProject(cases[0]);
      writeFixture(
        "package.json",
        JSON.stringify({ ...manifest, dependencies: { react: version } }),
      );
      expect(inspect(filename).diagnostics).toHaveLength(1);
    },
  );
  it.each(["file:./runtime", "npm:other@19.2.0", "workspace:*", "*", "19 || 20", ">=19"])(
    "refuses unknown provider declaration %s",
    (version) => {
      const filename = writeProject(cases[0]);
      writeFixture(
        "package.json",
        JSON.stringify({ ...manifest, dependencies: { react: version } }),
      );
      expect(inspect(filename).diagnostics).toHaveLength(0);
    },
  );
  it("refuses any visible package Babel field", () => {
    const filename = writeProject(cases[0]);
    writeFixture("package.json", JSON.stringify({ ...manifest, babel: {} }));
    expect(inspect(filename).diagnostics).toHaveLength(0);
  });
  it("requires the owning React declaration", () => {
    const filename = writeProject(cases[0]);
    writeFixture("package.json", JSON.stringify({ private: true, type: "module" }));
    expect(inspect(filename).diagnostics).toHaveLength(0);
  });
  it("keeps the existing direct native URL path", () => {
    const filename = writeFixture(
      "src/app.tsx",
      "export const View=({file})=><img src={URL.createObjectURL(file)}/>;",
    );
    expect(inspect(filename).diagnostics).toHaveLength(1);
  });
  it("retains the existing shadowed URL refusal", () => {
    const filename = writeProject({
      ...cases[0],
      caller: caller.replace(
        "export const View",
        "const URL={createObjectURL:()=> 'ordinary.png'}; export const View",
      ),
    });
    expect(inspect(filename).diagnostics).toHaveLength(0);
  });
  it("does not fingerprint positive, negative, missing or symlink helper candidates", () => {
    const filename = writeProject(cases[0]);
    const helper = path.join(temporaryDirectory, "src/preview.tsx");
    const passive = producer;
    for (const producer of [passive, "export const show = (url,theme) => null;", passive]) {
      fs.writeFileSync(helper, producer);
      expect(collect(filename)).toBeNull();
      const warm = inspect(filename);
      resetFilesystemCaches();
      expect(inspect(filename)).toEqual(warm);
    }
    fs.unlinkSync(helper);
    expect(collect(filename)).toBeNull();
    resetFilesystemCaches();
    expect(inspect(filename).diagnostics).toHaveLength(0);
    fs.writeFileSync(helper, passive);
    resetFilesystemCaches();
    expect(inspect(filename).diagnostics).toHaveLength(1);
    const target = writeFixture("src/actual.tsx", passive);
    fs.unlinkSync(helper);
    fs.symlinkSync(target, helper);
    resetFilesystemCaches();
    expect(collect(filename)).toBeNull();
    expect(inspect(filename).diagnostics).toHaveLength(0);
    fs.unlinkSync(helper);
    fs.writeFileSync(helper, passive);
    resetFilesystemCaches();
    expect(collect(filename)).toBeNull();
    expect(inspect(filename).diagnostics).toHaveLength(1);
  });
  it.each([
    "URL.createObjectURL(file)",
    "URL['createObjectURL'](file)",
    "URL[`createObjectURL`](file)",
    "(URL.createObjectURL as (file: Blob) => string)(file)",
    "local.createObjectURL(file)",
  ])("refuses fingerprinting before candidate resolution: %s", (expression) => {
    const filename = writeFixture(
      "src/app.tsx",
      `const local={createObjectURL:()=>''}; const file=new Blob([]); ${expression};`,
    );
    expect(collect(filename)).toBeNull();
  });
  it("returns an empty read set when no potential method call exists", () => {
    const filename = writeFixture("src/app.tsx", "export const View=()=>null;");
    const trace = collect(filename);
    expect(trace).not.toBeNull();
    expect(trace?.contentPaths.size).toBe(0);
    expect(trace?.existencePaths.size).toBe(0);
  });
});
