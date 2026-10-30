import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

interface NativeBooleanPayloadCase {
  name: string;
  source: string;
  diagnosticCount: number;
}

const nativeBooleanPayloadCases: NativeBooleanPayloadCase[] = [
  {
    name: "type-only-namespace-provider",
    source:
      'namespace globalThis {export namespace Shape {export interface Marker {}}}\nglobalThis.Boolean=customBoolean;\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "empty-namespace-provider",
    source:
      'namespace globalThis {}\nglobalThis.Boolean=customBoolean;\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "runtime-namespace-provider",
    source:
      'namespace globalThis {export const marker=true;}\nglobalThis.Boolean=customBoolean;\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 0,
  },
  {
    name: "type-import-equals-provider",
    source:
      'import type globalThis = require("./types");globalThis.Boolean=customBoolean;\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "local-interface-provider",
    source:
      'const globalThis={Boolean:customBoolean};interface globalThis {}globalThis.Boolean=customBoolean;\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 0,
  },
  {
    name: "erased-interface-global-provider",
    source:
      'interface globalThis {} globalThis.Boolean=customBoolean;import React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "erased-ambient-global-provider",
    source:
      'declare const globalThis: any; globalThis.Boolean=customBoolean;import React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "type-only-import-global-provider",
    source:
      'import type {window} from "./types"; window.Boolean=customBoolean;import React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "inert-erased-global-provider",
    source:
      'interface globalThis {}import React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 0,
  },
  {
    name: "real-local-global-provider",
    source:
      'const globalThis={Boolean: customBoolean};globalThis.Boolean=otherBoolean;import React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 0,
  },
  {
    name: "external-direct",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-and-prop",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=enabled && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-double-not-prop",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=!!enabled && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-native-boolean-prop",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=Boolean(enabled) && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-native-boolean-result",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=Boolean(media);\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-native-boolean-inline",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n \n React.useEffect(()=>{onChange(Boolean(enabled) && media);},[Boolean(enabled) && media,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-child-state",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n const [child]=React.useState(false);\n const value=child && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "external-native-boolean-child",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n const [child]=React.useState(false);\n const value=Boolean(child) && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 1,
  },
  {
    name: "external-shadowed-boolean",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n const Boolean=()=>readChild();\n const value=Boolean(enabled) && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 1,
  },
  {
    name: "external-opaque-conversion",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=convert(enabled) && media;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 1,
  },
  {
    name: "external-mutable-derived",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n let reported=media; reported=readChild();\n const value=reported;\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 1,
  },
  {
    name: "native-boolean-prop-only",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{\n const media=useMediaQuery('(max-width: 600px)');\n \n const value=Boolean(enabled);\n React.useEffect(()=>{onChange(value);},[value,onChange]);\n return null;\n};\n",
    diagnosticCount: 0,
  },
  {
    name: "opaque-child-plain",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=readChild() && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "opaque-child-boolean",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(readChild()) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "state-opaque-child-plain",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const[child]=React.useState(readChild());const value=child && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "state-opaque-child-boolean",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const[child]=React.useState(readChild());const value=Boolean(child) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "global-boolean-direct-replacement",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');Boolean=()=>readChild();const value=Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "globalthis-boolean-replacement",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');globalThis.Boolean=()=>readChild();const value=Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "window-boolean-replacement",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');window.Boolean=()=>readChild();const value=Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-alias-replacement",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const provider=globalThis;provider.Boolean=()=>readChild();const value=Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-opaque-escape",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');install(globalThis);const value=Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "extra-argument-opaque",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled,readChild()) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "boolean-constructor",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=new Boolean(enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "boolean-member-call",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean.call(null,enabled) && media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};\n",
    diagnosticCount: 1,
  },
  {
    name: "readonly-prop-and-alias",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const alias=enabled; const native=Boolean(alias); const value=native && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "unrelated-sibling-default",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled, width=readChild(),onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "payload-default-producer",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled=readChild(),onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "payload-literal-default",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled=false,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "payload-enclosing-default",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({settings:{enabled}=readChild(),onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "dynamic-sibling-argument",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const[child,setChild]=React.useState(false); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value, child);},[value,onChange]); return <button onClick={()=>setChild(true)}>Change</button>;};",
    diagnosticCount: 1,
  },
  {
    name: "readonly-literal-input",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const active=true; const value=Boolean(active) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "boolean-metadata-write",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); Boolean.description=\"meta\"; const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "boolean-computed-key-read",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); let ignored; ({[Boolean]:ignored}=source); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "boolean-default-rhs-read",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); let ignored; ({ignored=Boolean}=source); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "boolean-member-target-metadata",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); ({metadata:Boolean.description}=source); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "boolean-binding-pattern-default-target",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); ({value:Boolean=fake}=source); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-binding-pattern-target",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); [Boolean]=source; const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-reflect-write",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); Reflect.set(globalThis,\"Boolean\",fake); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-descriptor-write",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); Object.defineProperty(globalThis,\"Boolean\",{value:fake}); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-unknown-computed-write",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); globalThis[key]=fake; const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-function-constructor-exposure",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const factory=(()=>{}).constructor; factory(\"globalThis.Boolean=()=>true\")(); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-destructured-constructor-exposure",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const {constructor:factory}=()=>{}; factory(\"globalThis.Boolean=()=>true\")(); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-dynamic-destructured-native-exposure",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const {[key]:factory}=()=>{}; factory(\"globalThis.Boolean=()=>true\")(); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-extracted-callable-escape",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); install(globalThis.Boolean); const value=Boolean(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 1,
  },
  {
    name: "typescript-wrapped-native-callee",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=(Boolean as typeof Boolean)(enabled) && media; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "typescript-wrapped-payload",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{ const media=useMediaQuery('(max-width: 600px)'); const value=(Boolean(enabled) && media) as boolean; React.useEffect(()=>{onChange(value);},[value,onChange]); return null;};",
    diagnosticCount: 0,
  },
  {
    name: "independent-child-plain",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=child && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 0,
  },
  {
    name: "independent-child-native-boolean",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=Boolean(child) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-child-double-negation",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=!!child && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 0,
  },
  {
    name: "independent-parent-plain-sibling-child",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=enabled && child;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 0,
  },
  {
    name: "independent-parent-native-boolean-sibling-child",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=Boolean(enabled) && child;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-parent-double-negation-sibling-child",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);const reported=!!enabled && child;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 0,
  },
  {
    name: "independent-child-native-inline",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(false);React.useEffect(()=>{onChange(Boolean(child) && media);},[enabled,media,child,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-child-null-init-native",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(null);const reported=Boolean(child) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-child-opaque-init-native",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useState(readChild());const reported=Boolean(child) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-uncontrolled-hook-native",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst useLocalBoolean=()=>React.useState(false);\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=useLocalBoolean();const reported=Boolean(child) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },
  {
    name: "independent-no-child-parent-external",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const reported=Boolean(enabled) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return null;};\n",
    diagnosticCount: 0,
  },
  {
    name: "independent-reducer-owned-native",
    source:
      "import React from 'react';\nimport {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"(max-width: 600px)\");const [child,setChild]=React.useReducer((previous,action)=>action,false);const reported=Boolean(child) && media;React.useEffect(()=>{onChange(reported);},[enabled,media,reported,onChange]);return <button type=\"button\" onClick={()=>setChild(true)}>change</button>;};\n",
    diagnosticCount: 1,
  },

  {
    name: "global-provider-eval-call",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');globalThis.eval(\"Boolean=()=>true\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "window-provider-eval-call",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');window.eval(\"Boolean=()=>true\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-function-call",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');globalThis.Function(\"Boolean=()=>true\")();const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "window-provider-computed-function-call",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');window[\"Function\"](\"Boolean=()=>true\")();const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },

  {
    name: "adversarial-globalThis-eval",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nglobalThis.eval(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-globalThis-Function",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nglobalThis.Function(\"globalThis.Boolean=()=>readChild()\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-globalThis-eval-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst execute=globalThis.eval;execute(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-window-eval",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nwindow.eval(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-window-Function",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nwindow.Function(\"globalThis.Boolean=()=>readChild()\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-window-eval-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst execute=window.eval;execute(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-self-eval",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nself.eval(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-self-Function",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nself.Function(\"globalThis.Boolean=()=>readChild()\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-self-eval-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst execute=self.eval;execute(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-global-eval",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nglobal.eval(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-global-Function",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nglobal.Function(\"globalThis.Boolean=()=>readChild()\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-global-eval-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst execute=global.eval;execute(\"globalThis.Boolean=()=>readChild()\");const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-native-pure-parent",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled);React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-nested-parent-default",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({settings:{enabled}=readChild(),onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-nested-parent-default-whole",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({settings:{enabled},onChange}=readChild())=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-payload-default-through-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled=readChild(),onChange})=>{const media=useMediaQuery(\"x\");const alias=enabled;const value=Boolean(alias)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-unrelated-default-safe",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,other=readChild(),onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-prop-reassignment",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");enabled=readChild();const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-prop-destructuring-write",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");({value:enabled}=source);const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-prop-closure-write",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const write=()=>{enabled=readChild();};write();const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-local-let-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");let alias=enabled;const value=Boolean(alias)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-state-through-alias",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const[child,setChild]=React.useState(false);const alias=child;const value=Boolean(enabled)&&alias;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-extra-child-arg",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const[child]=React.useState(false);const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,child);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-extra-literal-arg",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,true);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-extra-opaque-arg",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,readChild());},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-spread-arg",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,...values);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-prop-call-not-value",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled())&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-prop-not-bare",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=(props)=>{const media=useMediaQuery(\"x\");const onChange=props.onChange;const value=Boolean(props.enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-native-Boolean-escape",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\ninstall(Boolean);const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-Boolean-member-escape",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst convert=Boolean.valueOf;install(convert);const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-derived-constructor-call-result-pattern",
    source:
      'import React from \'react\'; import {useMediaQuery} from \'./use-media-query\';\nconst key="constructor"; const make=()=>()=>{};const {[key]:execute}=make();execute("globalThis.Boolean=()=>readChild()")();const Panel=({enabled,onChange})=>{const media=useMediaQuery("x");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "adversarial-derived-constructor-conditional-pattern",
    source:
      'import React from \'react\'; import {useMediaQuery} from \'./use-media-query\';\nconst key="constructor"; const {[key]:execute}=true?(()=>{}):(()=>{});execute("globalThis.Boolean=()=>readChild()")();const Panel=({enabled,onChange})=>{const media=useMediaQuery("x");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};',
    diagnosticCount: 1,
  },
  {
    name: "adversarial-with-replaces-Boolean",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nfunction install(){with({Boolean:()=>readChild()}){Boolean(true);}}const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-Boolean-delete-provider",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\ndelete globalThis.Boolean;const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-Boolean-provider-pattern-write",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\n({value:globalThis.Boolean}=source);const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-Boolean-provider-default-RHS-read",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nlet ignored;({ignored=globalThis.Boolean}=source);const Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-parent-opaque-object-truthiness",
    source:
      "import React from 'react'; import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery(\"x\");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-sloppy-cjs-with-payload-Boolean",
    source:
      "const React=require('react'); const {useMediaQuery}=require('./use-media-query'); const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');with({Boolean:()=>readChild()}){const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);}return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-member-constructor-assignment",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";let execute;execute=(()=>{})[key];execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-return",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const make=()=>{return (()=>{})[key];};const execute=make();execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-arrow-return",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const make=()=>(()=>{})[key];const execute=make();execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-array",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const list=[(()=>{})[key]];const [execute]=list;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-object",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const record={execute:(()=>{})[key]};record.execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-conditional",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const execute=true?(()=>{})[key]:null;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-logical",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const execute=true&&(()=>{})[key];execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-default",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const {execute=(()=>{})[key]}={};execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-call-argument",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const invoke=(execute)=>execute('globalThis.Boolean=()=>readChild()')();;invoke((()=>{})[key]);const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-member-constructor-sequence",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst key=\"constructor\";const execute=(0,(()=>{})[key]);execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-scalar-computed-template-live",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst widths={small:1};const key=\"small\";const text=`${widths[key]}`;const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-scalar-computed-coercion-live",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst widths={small:1};const key=\"small\";const width=+widths[key];const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-reflect-get-constructor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst execute=Reflect.get(()=>{},'constructor');execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-object-descriptor-constructor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst execute=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(()=>{}),'constructor').value;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-reflect-get-alias",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst {get:read}=Reflect;const execute=read(()=>{},'constructor');execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-object-descriptor-alias",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst {getOwnPropertyDescriptor:read,getPrototypeOf:proto}=Object;const execute=read(proto(()=>{}),'constructor').value;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "synthetic-ref-callback-external-boolean",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,onChange})=>{const callback=React.useRef(onChange);React.useEffect(()=>{callback.current=onChange;},[onChange]);const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{callback.current?.(value);},[value]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "adversarial-provider-reflect-get-constructor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst execute=globalThis.Reflect.get(()=>{},'constructor');execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-provider-object-descriptor-constructor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst execute=globalThis.Object.getOwnPropertyDescriptor(globalThis.Object.getPrototypeOf(()=>{}),'constructor').value;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-provider-reflect-alias",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst reflection=globalThis.Reflect;const execute=reflection.get(()=>{},'constructor');execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-provider-object-alias",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst reflection=globalThis.Object;const execute=reflection.getOwnPropertyDescriptor(reflection.getPrototypeOf(()=>{}),'constructor').value;execute('globalThis.Boolean=()=>readChild()')();const Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useStableCallback-zeroarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useStableCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useStableCallback-literalarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useStableCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-React.useCallback-zeroarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=React.useCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-React.useCallback-literalarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=React.useCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useEventCallback-zeroarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useEventCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useEventCallback-literalarg",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useEventCallback(()=>{onChange(Boolean(child)&&media);},[]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useStableCallback-zeroarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useStableCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useStableCallback-literalarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useStableCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-React.useCallback-zeroarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=React.useCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-React.useCallback-literalarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=React.useCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useEventCallback-zeroarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useEventCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify();},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "adversarial-wrapper-hidden-child-useEventCallback-literalarg-closed-relevant-dependencies",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';\nconst Panel=({enabled,onChange})=>{const media=useMediaQuery('x');const[child,setChild]=React.useState(false);const notify=useEventCallback(()=>{onChange(Boolean(child)&&media);},[child,media,onChange]);React.useEffect(()=>{notify(true);},[notify]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-reflect-constructor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const execute=globalThis.Reflect.get(()=>{},\"constructor\");execute(\"globalThis.Boolean=()=>true\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "global-provider-object-descriptor",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const execute=globalThis.Object.getOwnPropertyDescriptor(globalThis.Object.getPrototypeOf(()=>{}),\"constructor\").value;execute(\"globalThis.Boolean=()=>true\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "conditional-unknown-pattern-source",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const key=\"constructor\";const{[key]:execute}=true?(()=>{}):(()=>{});execute(\"globalThis.Boolean=()=>true\")();const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-coercion-method-replacement",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';Boolean.toString=()=>\"constructor\";let ignored;({[Boolean]:ignored}=source);const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "boolean-coercion-valueof-replacement",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';Boolean.valueOf=()=>\"constructor\";let ignored;({[Boolean]:ignored}=source);const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "known-computed-key-read",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';let ignored;({[\"metadata\"]:ignored}=source);const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "known-computed-metadata-write",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';Boolean[\"description\"]=\"metadata\";const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "unresolved-scalar-template-read",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const values={label:\"active\"};const key=\"label\";const label=`${values[key]}`;void label;const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "unresolved-scalar-numeric-read",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const values={count:1};const key=\"count\";const count=+values[key];void count;const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 0,
  },
  {
    name: "benign-reflection-scope-control",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const keys=Object.keys({active:true});void keys;const Panel=({enabled,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};",
    diagnosticCount: 1,
  },
  {
    name: "parent-object-extra-argument-child-write",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);parent.value=child;const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,parent);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "parent-alias-extra-argument-child-write",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const target=parent;target.value=child;const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,target);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "parent-object-extra-argument-unsupported",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,parent);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 1,
  },
  {
    name: "parent-object-boolean-input-child-write",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);parent.value=child;const value=Boolean(parent)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 0,
  },
  {
    name: "parent-alias-boolean-input",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const target=parent;const value=Boolean(target)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 0,
  },
  {
    name: "parent-logical-operand-with-boolean-sibling",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const value=Boolean(enabled)&&parent;React.useEffect(()=>{onChange(value);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 0,
  },
  {
    name: "unrelated-sibling-default-conversion-input",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange,color=\"gray\"})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 0,
  },
  {
    name: "literal-secondary-argument",
    source:
      "import React from 'react';import {useMediaQuery} from './use-media-query';const Panel=({enabled,parent,onChange})=>{const media=useMediaQuery('(max-width: 600px)');const [child,setChild]=React.useState(false);const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value,1);},[value,onChange]);return <button onClick={()=>setChild(true)}/>;};",
    diagnosticCount: 0,
  },
];

describe("no-pass-data-to-parent native Boolean payloads", () => {
  it.each(nativeBooleanPayloadCases)("$name", ({ source, diagnosticCount }) => {
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});
