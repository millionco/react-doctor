import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "baseline-focus",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{await Promise.resolve(query);setValue(query);},[query,readValue]);useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 1,
  },
  {
    name: "merged-run-interface",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{await Promise.resolve(query);setValue(query);},[query,readValue]);interface run {}useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 1,
  },
  {
    name: "merged-run-type-alias",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{await Promise.resolve(query);setValue(query);},[query,readValue]);type run = {};useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 1,
  },
  {
    name: "merged-awaited-result-interface",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{const received=await readValue(query);interface received{};if(!received)setValue('empty');},[query,readValue]);useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 1,
  },
  {
    name: "inner-interface-outer-producer",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{interface readValue{};const received=await readValue(query);if(!received)setValue('empty');},[query,readValue]);useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 1,
  },
  {
    name: "merged-real-local-document",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{await Promise.resolve(query);setValue(query);},[query,readValue]);const document={hasFocus:()=>false};interface document{}useEffect(()=>{if(document.hasFocus())run();},[query,run]);return <output>{value}</output>};",
    expected: 0,
  },
  {
    name: "real-provider-write-under-type",
    code: "import {useCallback,useEffect,useState} from \"react\";\nexport const FocusPanel=({query,readValue}:{query:string,readValue:(value:string)=>Promise<string>})=>{const [value,setValue]=useState('');const run=useCallback(async()=>{await Promise.resolve(query);setValue(query);},[query,readValue]);useEffect(()=>{if(document.hasFocus())run();},[query,run]);const rewrite=()=>{interface document{};document.hasFocus=()=>false};rewrite();return <output>{value}</output>};",
    expected: 0,
  },
];

describe("finite Boolean input runtime binding identity", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, {
      filename: "src/components/binding-identity.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
