import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule, runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface ImportedConnectionCase {
  readonly name: string;
  readonly expected: number;
  readonly source: string;
  readonly producer: string | null;
  readonly files: Readonly<Record<string, string>>;
}
const temporaryRoot = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "rd-imported-connection-"),
);
afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
const write = (directory: string, filename: string, source: string) => {
  const destination = path.join(directory, filename);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
};
const createProject = (testCase: ImportedConnectionCase) => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "project-"));
  write(directory, "package.json", JSON.stringify({ dependencies: { react: "19.2.3" } }));
  write(directory, "entry.tsx", testCase.source);
  if (testCase.producer !== null) write(directory, "channel.ts", testCase.producer);
  for (const [filename, source] of Object.entries(testCase.files))
    write(directory, filename, source);
  return { directory, filename: path.join(directory, "entry.tsx") };
};
const resetLookups = () => {
  resetManifestCaches();
  __clearParseSourceFileCacheForTests();
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  resetTsconfigAliasCaches();
};
const BASE_SOURCE =
  'import {Channel} from "./channel"; import {useEffect,useRef} from "react";\nexport const Panel=({endpoint})=>{const host=useRef(null);useEffect(()=>{const node=host.current;if(!node)return;const client=new Channel();const pending=(async()=>{await client.activate(endpoint);})();return()=>{void pending.catch(console.error).then(()=>client.finish).catch(console.error);};},[endpoint]);return <video ref={host}/>;};';
const BASE_PRODUCER =
  'export class Channel {\n  private connection?: RTCPeerConnection;\n  private endpoint?: string;\n  public async activate(endpoint:string){\n    if(this.connection){await this.finish();}\n    const resource=new RTCPeerConnection({iceServers:[]});\n    this.connection=resource;\n    resource.addTransceiver("video",{direction:"recvonly"});\n    const received=new MediaStream();const ready=new Promise(resolve=>{resource.ontrack=event=>{received.addTrack(event.track);const enabled=resource.getTransceivers().filter(link=>link.mid!==null&&link.currentDirection!=="inactive");if(received.getTracks().length>=enabled.length)resolve();};});await observe(resource);await ready;\n    this.endpoint=endpoint;\n  }\n  public async finish(){\n    if(!this.connection){return;}\n    const resource=this.connection;\n    delete this.connection;\n    const endpoint=this.endpoint;\n    resource.close();\n    if(endpoint) await fetch(endpoint,{method:"DELETE"});\n  }\n}\nasync function observe(handle:RTCPeerConnection){\n return new Promise(resolve=>{\n   setTimeout(()=>resolve(handle.localDescription),10);\n   handle.onicegatheringstatechange=()=>{if(handle.iceGatheringState==="complete")resolve(handle.localDescription);};\n });\n}';
const DIRECT_PRODUCER = BASE_PRODUCER.replace(
  'const received=new MediaStream();const ready=new Promise(resolve=>{resource.ontrack=event=>{received.addTrack(event.track);const enabled=resource.getTransceivers().filter(link=>link.mid!==null&&link.currentDirection!=="inactive");if(received.getTracks().length>=enabled.length)resolve();};});',
  "",
).replace(";await ready", "");
const ERASED_SLOT_PRODUCER = BASE_PRODUCER.replace("await this.finish()", "return")
  .replace(": RTCPeerConnection", ":any")
  .replace("connection?", "connection")
  .replace("{\n  private", "{\n  declare");
const SECONDARY_PRODUCER = BASE_PRODUCER.replaceAll("Channel", "SecondChannel");
const BASE_PROJECT_CASE: ImportedConnectionCase = {
  name: "direct named own class and native observation helper",
  expected: 1,
  source: BASE_SOURCE,
  producer: BASE_PRODUCER,
  files: {},
};
const cases: ReadonlyArray<ImportedConnectionCase> = [
  BASE_PROJECT_CASE,
  {
    ...BASE_PROJECT_CASE,
    name: "custom method names do not determine ownership",
    source: BASE_SOURCE.replace("activate", "open").replace("finish", "dispose"),
    producer: DIRECT_PRODUCER.replace("activate", "open").replaceAll("finish", "dispose"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "default own class export",
    source: BASE_SOURCE.replace("Channel}", "Channel").replace("import {Channel", "import Channel"),
    producer: DIRECT_PRODUCER.replace("export", "export default"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "local class with separate named export",
    producer: DIRECT_PRODUCER.replace(
      "localDescription);};\n });\n}",
      "localDescription);};\n });\n}\nexport {Channel};",
    ).replace("export ", ""),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "declared root alias and canonical Next configuration",
    source: BASE_SOURCE.replace('from ".', 'from "@'),
    producer: DIRECT_PRODUCER,
    files: {
      "package.json":
        '{"dependencies": {"react": "19.2.3", "next": "16.2.6"}, "scripts": {"dev": "next dev", "build": "next build", "start": "next start"}}',
      "tsconfig.json":
        '{"compilerOptions": {"jsx": "react-jsx", "paths": {"@/*": ["./*"]}, "plugins": [{"name": "next"}]}}',
      "next.config.ts":
        'import type {NextConfig} from "next";const configuration:NextConfig={turbopack:{root:__dirname}};export default configuration;',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "passive CSS data stays outside executable closure",
    source: 'import "./surface.css";\n' + BASE_SOURCE,
    producer: DIRECT_PRODUCER,
    files: { "surface.css": ".pane{color:blue}" },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "unrelated numeric data does not change connection ownership",
    source: 'const table={small:2};const key="small";const measurement=table[key];\n' + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "immediate actual release invocation",
    expected: 0,
    source: BASE_SOURCE.replace("return()=>{", "return()=>{client.finish();"),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "promise callback really invokes release",
    expected: 0,
    source: BASE_SOURCE.replace("finish", "finish()"),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "actual release through another own callback",
    expected: 0,
    source: BASE_SOURCE.replace("return()=>{", "return()=>{release();").replace(
      ");const ",
      ");const release=()=>client.finish();const ",
    ),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "release getter is not a plain method value",
    expected: 0,
    producer: DIRECT_PRODUCER.replace(") await", ") void").replace("}\n  public async", "}\n  get"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "constructor can replace the instance",
    expected: 0,
    producer: DIRECT_PRODUCER.replace(
      "Channel {\n  ",
      "Channel {\n  constructor(){return replacement;} ",
    ),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "unknown base class declines",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("Channel", "Channel extends Base"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "acquiring method not called",
    expected: 0,
    source: BASE_SOURCE.replace("(endpoint", "(").replace("client.activate", "unrelated"),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "statically dead acquisition declines",
    expected: 0,
    source: BASE_SOURCE.replace("endpoint);", "endpoint);}").replace(
      "async()=>{",
      "async()=>{if(false){",
    ),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "suspension before native allocation declines",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("string){\n    ", "string){\n    await unrelated();"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "truthy initialized resource field declines",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("?: RTCPeerConnection", "=previousConnection"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "native constructor shadow is not a native allocation",
    expected: 0,
    producer: "const RTCPeerConnection=CustomConnection;\n" + DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "visible native global replacement declines",
    expected: 0,
    source: "window.RTCPeerConnection=CustomConnection;\n" + BASE_SOURCE,
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "alternate native provider alias declines",
    expected: 0,
    source:
      "const NativeConnection=window.RTCPeerConnection;NativeConnection.prototype.close=custom;\n" +
      BASE_SOURCE,
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "custom React effect binding declines",
    expected: 0,
    source: BASE_SOURCE.replace('react";\n', 'react";\nconst useEffect=customEffect;').replace(
      "useEffect,",
      "",
    ),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "named effect plus replaced default React provider declines",
    expected: 0,
    source: 'import React from "react";React.useEffect=custom;\n' + BASE_SOURCE,
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "exported class binding write declines",
    expected: 0,
    producer: DIRECT_PRODUCER + "\nChannel=OtherChannel;",
  },
  {
    ...BASE_PROJECT_CASE,
    name: "visible class prototype replacement declines",
    expected: 0,
    producer: DIRECT_PRODUCER + "\nChannel.prototype.activate=custom;",
  },
  {
    ...BASE_PROJECT_CASE,
    name: "computed own method is unsupported",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("activate", "[methodName]"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "instance capability escapes to unknown code",
    expected: 0,
    source: BASE_SOURCE.replace("Channel(", "Channel();opaque(client"),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "resource capability escapes to unknown code",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("await observe", "await opaque"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "own observer helper closes the native resource",
    expected: 0,
    producer: DIRECT_PRODUCER.replace(
      "RTCPeerConnection){\n ",
      "RTCPeerConnection){\n handle.close();",
    ),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "class invokes its own release after allocation",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("=resource", "=resource;this.finish()"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "registered native event callback closes resource",
    expected: 0,
    producer: DIRECT_PRODUCER.replace(
      "resource;\n    ",
      "resource;\n    resource.ontrack=()=>resource.close();",
    ),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "resource event receiver cannot supply implicit this",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("()=>{if", "(){if").replace(
      "onicegatheringstatechange=",
      "onicegatheringstatechange=function",
    ),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "different local instance release does not close selected instance",
    source: BASE_SOURCE.replace(
      ");const ",
      ");const sibling=new Channel();sibling.finish();const ",
    ),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "opaque method callback transport declines",
    expected: 0,
    source: BASE_SOURCE.replace("then(()=>", "then("),
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "same class method names without native resource allocation",
    expected: 0,
    producer: DIRECT_PRODUCER.replace("new RTCPeerConnection", "makeData").replace(
      "{iceServers:[]}",
      "",
    ),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "missing own class producer declines",
    expected: 0,
    producer: null,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "compiler provider override declines",
    expected: 0,
    producer: DIRECT_PRODUCER,
    files: {
      "next.config.ts": "export default {webpack:configure};",
      "package.json": '{"dependencies":{"react":"19.2.3","next":"16.2.6"}}',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "unreachable sole caller of local async acquisition",
    expected: 0,
    source: BASE_SOURCE.replace(
      "endpoint);",
      "endpoint);};if(false){void task();}const pending=(async()=>{",
    )
      .replace("=(async", "=async")
      .replace("const pending", "const task"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "async generator IIFE is not an executing native Promise",
    expected: 0,
    source: BASE_SOURCE.replace("()=>{await", "(){await").replace("async", "async function*"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "permanently unsettled prior await prevents acquisition",
    expected: 0,
    source: BASE_SOURCE.replace("await ", "await new Promise(()=>{});await "),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "native inherited member invalidates assumed empty erased slot",
    expected: 0,
    producer: ERASED_SLOT_PRODUCER.replaceAll("connection", "toString"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "computed prototype receiver write invalidates erased slot",
    expected: 0,
    source: "const key='__proto__';({})[key].connection=true;\n" + BASE_SOURCE,
    producer: ERASED_SLOT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "qualified global Object can replace native provider",
    expected: 0,
    source:
      'globalThis.Object.defineProperty(globalThis.window,"RTCPeerConnection",{value:Fake});\n' +
      BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "global reflection aliases cannot escape the namespace fence",
    expected: 0,
    source:
      'const NativeObject=globalThis.Object;NativeObject.defineProperty(window,"RTCPeerConnection",{value:Fake});\n' +
      BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "computed read data stays supported",
    source: 'const sizes={small:2};const key="small";const size=sizes[key];\n' + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "computed receiver aliases cannot mutate prototype defaults",
    expected: 0,
    source:
      'const key="__proto__";const inherited=({})[key];inherited.connection=true;\n' + BASE_SOURCE,
    producer: ERASED_SLOT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a captured awaited acquisition result is still the first operation",
    source: BASE_SOURCE.replace("async()=>{", "async()=>{const result="),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "earlier unknown argument evaluation is outside the direct prefix",
    expected: 0,
    source: BASE_SOURCE.replace("(endpoint", "(prepare()"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "effect callbacks themselves cannot be async",
    expected: 0,
    source: BASE_SOURCE.replace("useEffect(", "useEffect(async"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "qualified passive Object keys remains data-only",
    source: "const names=globalThis.Object.keys({small:2});\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "erased global namespace declaration cannot hide provider replacement",
    expected: 0,
    source:
      'declare const globalThis:any;globalThis.Object.defineProperty(globalThis.window,"RTCPeerConnection",{value:Fake});\n' +
      BASE_SOURCE,
  },
  {
    name: "reassigned mutation receiver alias",
    source:
      "const propertyKey=['__proto__'][0];let holder={};holder=({})[propertyKey];holder.connection=true;\n" +
      BASE_SOURCE,
    producer: ERASED_SLOT_PRODUCER,
    files: {},
    expected: 0,
  },
  {
    name: "mutation receiver passed through an own parameter",
    source:
      "const propertyKey=['__proto__'][0];function patch(target){target.connection=true;}patch(({})[propertyKey]);\n" +
      BASE_SOURCE,
    producer: ERASED_SLOT_PRODUCER,
    files: {},
    expected: 0,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "opaque returned mutation receiver is unsupported",
    expected: 0,
    source: "const target=resolveTarget();target.connection=true;\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "nested member mutation receiver is unsupported",
    expected: 0,
    source: "const holder={};holder.target.connection=true;\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "computed mutation keys stay conservative",
    expected: 0,
    source: "const field=resolveField();const holder={};holder[field]=true;\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "unchanged own literal receiver writes do not affect the resource slot",
    source: "const holder={};holder.connection=true;\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "unrelated observer parameter writes remain ordinary data operations",
    source: "function watch(target){target.onicegatheringstatechange=()=>{};}\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "an unclosed one-method local class writer stays unsupported",
    expected: 0,
    source:
      "class OtherChannel{private connection;replace(){this.connection=null;}}\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "ordinary class method receivers cannot be explicitly rebound",
    expected: 0,
    source:
      "class OtherChannel{replace(){this.connection=true;}}const entry=new OtherChannel();entry.replace.call(resolveTarget());\n" +
      BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "an ordinary function receiver is not a class instance",
    expected: 0,
    source: "function patch(){this.connection=true;}\n" + BASE_SOURCE,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "borrowed ordinary class method changes inherited selected slot",
    expected: 0,
    source: 'import "./poison";\n' + BASE_SOURCE,
    producer: ERASED_SLOT_PRODUCER,
    files: {
      "poison.js":
        "class Patch { run(){ this.connection=true; } }\nconst patch=new Patch().run;\nconst key=['__proto__'][0];\nconst target=({})[key];\ntarget.run=patch;\ntarget.run();\n",
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a passive secondary class instance keeps its own receiver",
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";const second=new SecondChannel();second.activate("endpoint");',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a genuine React ref keeps a passive secondary receiver",
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef} from "react";export const Other=()=>{const receiver=useRef<SecondChannel>(new SecondChannel());const start=()=>receiver.current.activate("endpoint");return <button onClick={start}/>;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "extracted secondary mutators cannot be attached to a carrier",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";const second=new SecondChannel();const key=["__proto__"][0];const carrier=({})[key];carrier.patch=second.activate;carrier.patch();',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a secondary ref current cannot be replaced",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef} from "react";export const Other=()=>{const receiver=useRef(new SecondChannel());receiver.current=unknown;return null;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a secondary ref cannot be handed to JSX",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef} from "react";export const Other=()=>{const receiver=useRef(new SecondChannel());return <Unknown receiver={receiver}/>;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a secondary method cannot escape as an opaque callback",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";const second=new SecondChannel();opaque(second.activate);',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a custom ref-named factory does not establish a native ref",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";const useRef=value=>({current:value});const receiver=useRef(new SecondChannel());receiver.current.activate("endpoint");',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a later fulfillment reaction could receive the returned method",
    expected: 0,
    source: BASE_SOURCE.replace("finish).", "finish).then(opaque)."),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a later finally transport is outside the discarded rejection chain",
    expected: 0,
    source: BASE_SOURCE.replace("finish).", "finish).finally(opaque)."),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "the method-result chain cannot be saved as an element or callback carrier",
    expected: 0,
    source: BASE_SOURCE.replace("error);", "error);opaque(saved);")
      .replace(" pending.", " saved=pending.")
      .replace("void", "const"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "the method-result chain cannot be returned from cleanup",
    expected: 0,
    source: BASE_SOURCE.replace("void", "return"),
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a ref-held secondary method value remains discarded in native cleanup",
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef,useEffect} from "react";export const Other=()=>{const receiver=useRef<SecondChannel>(new SecondChannel());const pending=(async()=>{await receiver.current.activate("endpoint");})();useEffect(()=>{return()=>{void pending.catch(console.error).then(()=>receiver.current.finish).catch(console.error);};},[]);return null;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a ref-held secondary mutator cannot be extracted",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef,useEffect} from "react";export const Other=()=>{const receiver=useRef<SecondChannel>(new SecondChannel());const extracted=receiver.current.activate;opaque(extracted);return null;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a native ref current cannot be aliased as an instance",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import {useRef,useEffect} from "react";export const Other=()=>{const receiver=useRef<SecondChannel>(new SecondChannel());const instance=receiver.current;instance.activate("endpoint");return null;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "a replaced native ref provider cannot establish a closed receiver",
    expected: 0,
    files: {
      "secondary.ts": SECONDARY_PRODUCER,
      "other.tsx":
        'import {SecondChannel} from "./secondary";import React,{useRef} from "react";React.useRef=customRef;export const Other=()=>{const receiver=useRef(new SecondChannel());receiver.current.activate("endpoint");return null;};',
    },
  },
  {
    ...BASE_PROJECT_CASE,
    name: "fuzz robustness: as-any call receivers",
    source:
      'import {Channel} from "./channel"; import {useEffect,useRef} from "react";\nexport const Panel=({endpoint})=>{const host=useRef(null);useEffect(()=>{const node=host.current;if(!node)return;const client=new Channel();const pending=(async()=>{await (client as any).activate(endpoint);})();return()=>{void (((pending as any).catch(console.error) as any).then(()=>client.finish) as any).catch(console.error);};},[endpoint]);return <video ref={host}/>;};',
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "fuzz robustness: non-null-asserted call receivers",
    source:
      'import {Channel} from "./channel"; import {useEffect,useRef} from "react";\nexport const Panel=({endpoint})=>{const host=useRef(null);useEffect(()=>{const node=host.current;if(!node)return;const client=new Channel();const pending=(async()=>{await (client!).activate(endpoint);})();return()=>{void (((pending!).catch(console.error)!).then(()=>client.finish)!).catch(console.error);};},[endpoint]);return <video ref={host}/>;};',
    producer: DIRECT_PRODUCER,
  },
  {
    ...BASE_PROJECT_CASE,
    name: "fuzz robustness: no-op prologue statement in every function body",
    source:
      'import {Channel} from "./channel"; import {useEffect,useRef} from "react";\nexport const Panel=({endpoint})=>{ void 0;const host=useRef(null);useEffect(()=>{ void 0;const node=host.current;if(!node)return;const client=new Channel();const pending=(async()=>{ void 0;await client.activate(endpoint);})();return()=>{ void 0;void pending.catch(console.error).then(()=>client.finish).catch(console.error);};},[endpoint]);return <video ref={host}/>;};',
    producer: DIRECT_PRODUCER,
  },
];
describe("effect-owned imported native connection method values", () => {
  for (const testCase of cases)
    it(testCase.name, () => {
      resetLookups();
      const { filename } = createProject(testCase);
      const result = runRule(effectNeedsCleanup, testCase.source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  it("does not treat an erased native provider declaration as the platform constructor", () => {
    const testCase = cases[0];
    const changed = {
      ...testCase,
      producer: "declare const RTCPeerConnection: unknown;\n" + testCase.producer,
    };
    const { filename } = createProject(changed);
    expect(runRule(effectNeedsCleanup, changed.source, { filename }).diagnostics).toEqual([]);
  });
  it("declines fingerprints before missing producer and configuration admission", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject({ ...testCase, producer: null });
    const probe = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: testCase.source,
        ruleIds: [effectNeedsCleanup.id],
      });
    expect(probe()).toBeNull();
    write(directory, "channel.ts", testCase.producer ?? "");
    resetLookups();
    expect(probe()).toBeNull();
    write(
      directory,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { react: ["./custom"] } } }),
    );
    resetLookups();
    expect(probe()).toBeNull();
  });
  it("rechecks missing, present and changed class with one entry AST", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject({ ...testCase, producer: null });
    const parsed = parseFixture(testCase.source, { filename });
    expect(parsed.errors).toEqual([]);
    const count = () =>
      runRuleOnParsedFixture(effectNeedsCleanup, testCase.source, parsed, { filename }).diagnostics
        .length;
    expect(count()).toBe(0);
    write(directory, "channel.ts", testCase.producer ?? "");
    resetLookups();
    expect(count()).toBe(1);
    write(
      directory,
      "other.ts",
      'import {Channel}from "./channel";Channel.prototype.activate=custom;',
    );
    resetLookups();
    expect(count()).toBe(0);
  });
  it("refuses a newly symlinked producer without rewriting the entry AST", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject(testCase);
    const parsed = parseFixture(testCase.source, { filename });
    const count = () =>
      runRuleOnParsedFixture(effectNeedsCleanup, testCase.source, parsed, { filename }).diagnostics
        .length;
    expect(count()).toBe(1);
    fs.renameSync(path.join(directory, "channel.ts"), path.join(directory, "replacement.ts"));
    fs.symlinkSync("replacement.ts", path.join(directory, "channel.ts"));
    resetLookups();
    expect(count()).toBe(0);
  });
  it("rechecks a compiler change after a positive result on the same AST", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject(testCase);
    const parsed = parseFixture(testCase.source, { filename });
    const count = () =>
      runRuleOnParsedFixture(effectNeedsCleanup, testCase.source, parsed, { filename }).diagnostics
        .length;
    expect(count()).toBe(1);
    write(directory, "babel.config.json", '{"plugins":["custom-transform"]}');
    resetLookups();
    expect(count()).toBe(0);
    fs.unlinkSync(path.join(directory, "babel.config.json"));
    resetLookups();
    expect(count()).toBe(1);
  });

  it("uses unsaved entry pragmas instead of saved source text", () => {
    const testCase = cases[0];
    const { filename } = createProject(testCase);
    const unsaved = "/** @jsx customFactory */\n" + testCase.source;
    const parsed = parseFixture(unsaved, { filename });
    expect(parsed.errors).toEqual([]);
    expect(
      runRuleOnParsedFixture(effectNeedsCleanup, unsaved, parsed, { filename }).diagnostics,
    ).toEqual([]);
  });
  it("uses a clean current entry instead of an obsolete saved pragma", () => {
    const testCase = cases[0];
    const { directory, filename } = createProject(testCase);
    write(directory, "entry.tsx", "/** @jsx customFactory */\n" + testCase.source);
    const parsed = parseFixture(testCase.source, { filename });
    expect(parsed.errors).toEqual([]);
    expect(
      runRuleOnParsedFixture(effectNeedsCleanup, testCase.source, parsed, { filename }).diagnostics,
    ).toHaveLength(1);
  });
});
