import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const cases = [
  {
    name: "useState-unmasked",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){mutate(useState);}expose();',
    expectedCount: 1,
  },
  {
    name: "useState-interface",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){interface useState {}mutate(useState);}expose();',
    expectedCount: 1,
  },
  {
    name: "useState-type-alias",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){type useState=unknown;mutate(useState);}expose();',
    expectedCount: 1,
  },
  {
    name: "useState-real-local-interface",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){const useState=()=>[];interface useState {}mutate(useState);}expose();',
    expectedCount: 0,
  },
  {
    name: "document-unmasked",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){mutate(document);}expose();',
    expectedCount: 1,
  },
  {
    name: "document-interface",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){interface document {}mutate(document);}expose();',
    expectedCount: 1,
  },
  {
    name: "document-type-alias",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){type document=unknown;mutate(document);}expose();',
    expectedCount: 1,
  },
  {
    name: "document-real-local-interface",
    code: '\nimport {useEffect,useState} from "react";export const Panel=()=>{const[host,setHost]=useState(null);useEffect(()=>{const node=document.getElementById("host");if(node)setHost(node);},[]);useEffect(()=>{if(!host)return;host.style.pointerEvents="none";},[host]);return <div/>;};import {mutate} from "./external";function expose(){const document={getElementById:()=>null};interface document {}mutate(document);}expose();',
    expectedCount: 0,
  },
];

describe("no-direct-state-mutation runtime provider references", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noDirectStateMutation, code, {
      filename: "/tmp/rd-runtime-provider-references/view.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
