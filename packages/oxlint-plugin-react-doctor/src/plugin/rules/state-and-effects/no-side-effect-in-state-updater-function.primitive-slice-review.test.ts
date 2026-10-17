import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

const cases = [
  {
    name: "nominal",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "global-require-react-write",
    code: 'require("react").useState = replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "global-module-react-write",
    code: 'module.require("react").useState = replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "dynamic-import-react-write",
    code: 'const reactModule=await import("react");reactModule.useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "local-require-control",
    code: 'const require=()=>({useState:0});require("react").useState=1;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "foreign-require-control",
    code: 'require("foreign-library").useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "merged-hook-interface",
    code: 'import { useState } from "react"; interface useState {} export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "merged-parameter-interface",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { interface label {} const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "merged-state-interface",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); interface entries {} setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "typeonly-outer-selected-name",
    code: 'import type {label} from "foreign";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "masked-react-import-escape",
    code: 'import { useState } from "react"; const expose=()=>{interface useState{}; consume(useState);}; expose(); export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-parameter-destructuring-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { ({label}=replacement); const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "same-producer-require-write",
    code: 'require("./entry-data").loadEntries=replacement;import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "same-producer-module-write",
    code: 'module.require("./entry-data").loadEntries=replacement;import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "same-producer-dynamic-write",
    code: 'const entryModule=await import("./entry-data");entryModule.loadEntries=replacement;import { loadEntries } from "./entry-data";import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]); setEntries(loadEntries()); setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "unknown-require-write",
    code: 'require(moduleSource).useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "unknown-dynamic-import-write",
    code: 'const reactModule=await import(moduleSource);reactModule.useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "foreign-module-control",
    code: 'module.require("foreign-library").useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "foreign-dynamic-import-control",
    code: 'const foreignModule=await import("foreign-library");foreignModule.useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "merged-real-loader-control",
    code: 'const require=()=>({useState:0});interface require{};require("react").useState=1;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 0,
  },
  {
    name: "erased-loader-actual-global-write",
    code: 'interface require{};require("react").useState=replacement;import { useState } from "react"; export const Example = (position: number, label: string) => { const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-index-destructuring-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { ({position}=replacement); const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-array-pattern-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { [label]=replacement; const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-default-pattern-write",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { ({label="default"}=replacement); const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-computed-key-read-unsupported-program",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { let observed; ({[label]:observed}=replacement); const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
  {
    name: "primitive-member-target-index-read-unsupported-program",
    code: 'import { useState } from "react"; export const Example = (position: number, label: string) => { externalValues[position]=label; const [entries, setEntries] = useState<string[]>([]);  setEntries(previous => { const copy = previous.slice(0, position); copy[position] = label; return copy; }); return <output>{entries[0]}</output>; };',
    expected: 1,
  },
];

describe("primitive slice provider and binding ownership", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noSideEffectInStateUpdaterFunction, code, {
      filename: "src/components/primitive-slice.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
