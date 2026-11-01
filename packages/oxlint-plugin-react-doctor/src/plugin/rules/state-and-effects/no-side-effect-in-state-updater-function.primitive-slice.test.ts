import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

const cases = [
  {
    name: "outer-native-copy",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "literal-next-state-writer",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(["before"]); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "imported-producer-state-writer",
    code: 'import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "numeric-loop-state-observation",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); for(let index=0;index<2;index++){ const value=entries[index-1]; } setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "nested-copy-element-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position].value = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "previous-array-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); previous[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "copy-callback-escape",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); consume(copy); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "state-callback-escape",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); consume(entries); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "state-member-transport",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); const method=entries.slice; consume(method); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "state-alias-transport",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); const alias=entries; consume(alias); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "local-opaque-replacement",
    code: 'const loadEntries = () => replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "identifier-state-replacement",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(replacement); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "own-slice-replacement",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); entries.slice = replacement; setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "prototype-slice-replacement",
    code: 'Array.prototype.slice = replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "computed-prototype-alias",
    code: 'const propertyName="__proto__"; const provider=[][propertyName]; provider.slice=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "unknown-computed-provider",
    code: 'const propertyName=unknownName; const provider=[][propertyName]; provider.slice=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "pattern-constructor-exposure",
    code: 'const {constructor: provider}=[]; consume(provider);import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "species-customization",
    code: 'Object.defineProperty(Array,Symbol.species,{value:replacement});import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "coercive-bound",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy=previous.slice(0,{valueOf:()=>position}); copy[position]=label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "coercive-assignment-key",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy=previous.slice(0,position); copy[{toString:()=>"0"}]=label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "ambient-numeric-parameter-substitute",
    code: 'declare const ambientPosition:number;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy=previous.slice(0,ambientPosition); copy[position]=label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "erased-runtime-reference",
    code: 'interface Array {} consume(Array);import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "dynamic-eval",
    code: 'eval("void 0");import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "erased-wrapper-inert-atom",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy=previous.slice(0,(position as number)); copy[position]=label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "readonly-captured-loop-index",
    code: 'import {useState} from "react"; export const Example=(position:number,label:string)=>{const [entries,setEntries]=useState<string[]>([]);for(let index=0;index<2;index++){ const view=<button onClick={()=>consumeIndex(index)}>{entries[index-1]}</button>; }setEntries(previous=>{const copy=previous.slice(0,position);copy[position]=label;return copy;});return <output>{entries[0]}</output>;};',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "nested-loop-index-write",
    code: 'import {useState} from "react"; export const Example=(position:number,label:string)=>{const [entries,setEntries]=useState<string[]>([]);for(let index=0;index<2;index++){ const view=<button onClick={()=>{index=0}}>{entries[index-1]}</button>; }setEntries(previous=>{const copy=previous.slice(0,position);copy[position]=label;return copy;});return <output>{entries[0]}</output>;};',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "captured-loop-index-coercive-key",
    code: 'import {useState} from "react"; export const Example=(position:number,label:string)=>{const [entries,setEntries]=useState<string[]>([]);for(let index=0;index<2;index++){ const key={valueOf:()=>index}; const view=<button onClick={()=>consumeIndex(index)}>{entries[key]}</button>; }setEntries(previous=>{const copy=previous.slice(0,position);copy[position]=label;return copy;});return <output>{entries[0]}</output>;};',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "number-array-copy",
    code: 'import { useState } from "react"; export const Example = (position: number, label: number) => { const [entries, setEntries] = useState<number[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "boolean-array-copy",
    code: 'import { useState } from "react"; export const Example = (position: number, label: boolean) => { const [entries, setEntries] = useState<boolean[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "named-hook-import-alias",
    code: 'import { useState as useEntries } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useEntries<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "unbound-hook-not-new-profile",
    code: "export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };",
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "namespace-hook-not-new-profile",
    code: 'import * as React from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = React.useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "mutable-state-tuple",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { let [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "setter-transport",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); consume(setEntries); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "other-functional-state-writer",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(previous=>previous); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "imported-producer-transport",
    code: 'import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); consume(loadEntries); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "same-module-namespace-exposure",
    code: 'import * as entryModule from "./entry-data"; consume(entryModule);import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "same-module-named-provider-exposure",
    code: 'import { loadEntries as otherLoader } from "./entry-data"; consume(otherLoader);import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "react-provider-property-replacement",
    code: 'import React, { useState } from "react"; React.useState=replacement; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "named-react-provider-assignment",
    code: 'import { useState } from "react"; useState=replacement; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "numeric-input-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); position=0; setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "primitive-input-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); label="changed"; setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "canonical-dependency-observation",
    code: 'import { useState, useMemo } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); useMemo(()=>entries[0],[entries]); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "shadowed-dependency-call",
    code: 'import { useState } from "react"; const observe = (_callback,_dependencies)=>0; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); observe(()=>0,[entries]); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "transparent-copy-return",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return (copy as string[]); }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "direct-function-expression-updater",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(function(previous) { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "extra-updater-expression",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); consume(position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "destructured-reflection-provider",
    code: 'const {getPrototypeOf: inspect}=provider; inspect([]);import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "ambient-eval-mask",
    code: 'declare const eval:(source:string)=>unknown; eval("void 0");import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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
    name: "nested-erased-state-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); const reset=()=>{interface entries{}; entries[0]="changed";}; reset(); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
    options: {
      filename: "src/components/slice-copy.tsx",
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

describe("no-side-effect-in-state-updater-function primitive native slice copies", () => {
  it.each(cases)("$name", ({ code, expected, options }) => {
    const result = runRule(noSideEffectInStateUpdaterFunction, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
