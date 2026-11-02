import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "nested-split-indexed-string-child",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "bare-token-already-covered",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}>{part}</span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-child-call-retains",
    code: 'export const Example=({text,render}:{text:string,render:(value:string)=>unknown})=><span>{text.split(" ").map((part,index)=><span key={index}>{render(part)}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "interactive-descendant-retains",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><input defaultValue={part.split("=")[1]}/></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-split-object-retains",
    code: 'export const Example=({rows})=><span>{rows.map((part,index)=><span key={index}>{part.split("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "selected-token-write-retains",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{part=globalThis.custom;return <span key={index}>{part.split("=")[1]}</span>})}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "dynamic-index-deferred",
    code: 'export const Example=({text,key}:{text:string,key:string})=><span>{text.split(" ").map((part,index)=><span key={index}>{part.split("=")[key]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "custom-component-retains",
    code: 'const Child=({value})=><input defaultValue={value}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><Child value={part.split("=")[1]}/></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-conditional-child-existing-scanner-path",
    code: 'export const Example=({text,enabled}:{text:string,enabled:boolean})=><span>{text.split(" ").map((part,index)=><span key={index}>{enabled ? part.split("=")[1] : null}</span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-logical-child-existing-scanner-path",
    code: 'export const Example=({text,enabled}:{text:string,enabled:boolean})=><span>{text.split(" ").map((part,index)=><span key={index}>{enabled && part.split("=")[1]}</span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "zero-literal-selector-primitive-child",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><b>{part.split("=")[0]}</b></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-local-parts-alias-nested-child",
    code: 'export const Example=({text}:{text:string})=>{const parts=text.split(" ");return <span>{parts.map((part,index)=><span key={index}><em>{part.split("=")[1]}</em></span>)}</span>};',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "inner-regexp-separator-outside-finite-profile",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}>{part.split(/=/)[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "computed-inner-method-outside-finite-profile",
    code: 'export const Example=({text,method}:{text:string,method:string})=><span>{text.split(" ").map((part,index)=><span key={index}>{part[method]("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "lexically-shadowed-item-custom-split",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{ {const part={split:()=>[<input/>]};return <span key={index}>{part.split("=")[1]}</span>} })}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "visible-string-prototype-method-replacement",
    code: 'String.prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}>{part.split("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "typed-root-write-to-custom-source",
    code: 'export const Example=({text}:{text:string})=>{text=custom;return <span>{text.split(" ").map((part,index)=><span key={index}>{part.split("=")[1]}</span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "custom-symbol-split-outer-provider",
    code: 'const separator={[Symbol.split](){return [<input/>]}};export const Example=({text}:{text:string})=><span>{text.split(separator).map((part,index)=><span key={index}>{part.split("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "event-bound-inline-row-not-new-exception",
    code: 'export const Example=({text,observe}:{text:string,observe:(value:string)=>void})=><span>{text.split(" ").map((part,index)=><span key={index} onClick={()=>observe(part)}>{part.split("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ref-bound-inline-row-not-new-exception",
    code: 'export const Example=({text,reference}:{text:string,reference:unknown})=><span>{text.split(" ").map((part,index)=><span key={index} ref={reference}>{part.split("=")[1]}</span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "direct-string-parameter",
    code: 'export const Example=(text:string)=><span>{text.split(" ").map((token,index)=><span key={index}><b>{token.split(":")[2]}</b></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "literal-source-and-empty-separator",
    code: 'export const Example=()=> <span>{"alpha=beta".split(" ").map((token,index)=><span key={index}><span>{token.split("")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "local-array-property-write",
    code: 'export const Example=({text}:{text:string})=>{const parts=text.split(" ");parts.map=replacement;return <span>{parts.map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "local-array-transport",
    code: 'export const Example=({text}:{text:string})=>{const parts=text.split(" ");observe(parts);return <span>{parts.map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "token-member-replacement",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{part.split=replacement;return <span key={index}><span>{part.split("=")[1]}</span></span>})}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "token-loop-assignment",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{for(part of custom){}return <span key={index}><span>{part.split("=")[1]}</span></span>})}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "root-loop-assignment",
    code: 'export const Example=({text}:{text:string})=>{for(text of custom){}return <span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "source-parameter-replacement",
    code: 'export const Example=({text}:{text:string})=>{text=custom;return <span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "string-constructor-alias-exposure",
    code: 'const NativeString=String;observe(NativeString);export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "array-prototype-map-write",
    code: 'Array.prototype.map=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "global-qualified-string-write",
    code: 'globalThis.String.prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "string-prototype-alias",
    code: 'const prototype=String.prototype;prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "literal-constructor-prototype-write",
    code: '"".constructor.prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "reflect-provider-write",
    code: 'Reflect.set(String.prototype,"split",replacement);export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-array-source",
    code: 'export const Example=({text}:{text:string})=><span>{buildParts(text).map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "outer-regexp-separator",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(/ /).map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "inner-second-argument",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=",2)[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "negative-index",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[-1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "fractional-index",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1.5]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "string-index",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")["1"]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "optional-inner-split-historically-quiet",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part?.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "computed-static-split-method",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part["split"]("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "spread-row-attributes",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index} {...attributes}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-event-row",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span onClick={observe}>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-ref-row",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span ref={reference}>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "ambient-declaration",
    code: 'declare const unavailable: unknown;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nested-erased-source-write",
    code: 'export const Example=({text}:{text:string})=>{const reset=()=>{interface text{};text=custom};reset();return <span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "erased-provider-write",
    code: 'interface String{};String.prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "runtime-namespace",
    code: 'namespace Setup { export const value=changeProvider(); }export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "runtime-enum",
    code: 'enum Setup { value=changeProvider() }export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "direct-eval",
    code: 'export const Example=({text}:{text:string})=>{eval("String.prototype.split=replacement");return <span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unused-erased-declarations",
    code: 'interface Unrelated {value:string};type Label=string;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "local-string-shadow-unrelated",
    code: 'const String={label:"local"};void String.label;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "destructured-source-alias",
    code: 'export const Example=({text:command}:{text:string})=><span>{command.split(" ").map((token,index)=><span key={index}><span>{token.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "parameter-nested-capture-write",
    code: 'export const Example=({text}:{text:string})=>{const reset=()=>{text=custom};reset();return <span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-local-parts-double-use",
    code: 'export const Example=({text}:{text:string})=>{const parts=text.split(" ");const length=parts.length;return <span>{parts.map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>};',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "literal-proto-carrier-write",
    code: 'const prototype="".__proto__;prototype.split=replacement;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "callback-third-array-parameter-write",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index,source)=>{source[index+1]=custom;return <span key={index}><span>{part.split("=")[1]}</span></span>})}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "const-computed-primitive-prototype-carrier",
    code: 'const propertyName="__proto__";const carrier=""[propertyName];const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-primitive-prototype-carrier",
    code: 'const propertyName=unknownName;const carrier=""[propertyName];const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "unknown-computed-literal-alias-carrier",
    code: 'const primitive="";const alias=primitive;const propertyName=unknownName;const carrier=alias[propertyName];const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "readonly-primitive-dictionary-sibling",
    code: 'const styles={small:"compact",large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "mutated-dictionary-sibling",
    code: 'const styles={small:"compact",large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;styles.small="changed";export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "escaped-dictionary-sibling",
    code: 'const styles={small:"compact",large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;observe(styles);export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "nonliteral-dictionary-sibling",
    code: 'const styles={small:buildClass(),large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "logical-primitive-unresolved-portal",
    code: 'const propertyName=unknownName;const carrier=(false||"")[propertyName];const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "destructured-primitive-prototype-portal",
    code: 'const {__proto__:carrier}="";const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "dictionary-aliased-object-reflection-member",
    code: 'const dictionary={small:"x"};const ObjectCarrier=dictionary[unknownKey];const carrier=ObjectCarrier.getPrototypeOf("");const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "dictionary-destructured-object-reflection",
    code: 'const dictionary={small:"x"};const ObjectCarrier=dictionary[unknownKey];const {getPrototypeOf:readPrototype}=ObjectCarrier;const carrier=readPrototype("");const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "dictionary-unknown-destructured-reflection",
    code: 'const dictionary={small:"x"};const ObjectCarrier=dictionary[unknownKey];const methodName=unknownMethod;const {[methodName]:readPrototype}=ObjectCarrier;const carrier=readPrototype("");const originalSplit=carrier.split;carrier.split=function(separator){return separator==="="?[null,<input/>]:originalSplit.call(this,separator)};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "duplicate-dictionary-keys",
    code: 'const styles={small:"compact",small:"second"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "spread-dictionary",
    code: 'const styles={...additional,large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "getter-dictionary",
    code: 'const styles={get small(){return "compact"},large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "method-dictionary",
    code: 'const styles={small(){return "compact"},large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "prototype-key-dictionary",
    code: 'const styles={__proto__:null,large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "exported-dictionary",
    code: 'export const styles={small:"compact",large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "aliased-dictionary",
    code: 'const styles={small:"compact",large:"roomy"};export const Sibling=({size})=><span className={styles[size]}/>;const alias=styles;void alias;export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 1,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "known-literal-numeric-index-sibling",
    code: 'const labels=["alpha","beta"];void labels[0];export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
  {
    name: "known-const-numeric-index-sibling",
    code: 'const labels=["alpha","beta"];const position=1;void labels[position];export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=><span key={index}><span>{part.split("=")[1]}</span></span>)}</span>;',
    expected: 0,
    options: {
      filename: "synthetic.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
        },
      },
    },
  },
];

describe("no-array-index-as-key primitive split-index text children", () => {
  it.each(cases)("$name", ({ code, expected, options }) => {
    const result = runRule(noArrayIndexAsKey, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
