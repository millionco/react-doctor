import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const cases = [
  [
    "positive-delayed-members",
    "import {useCallback,useMemo} from 'react';type Item={id:string;active:boolean};export function Panel({item}:{item:Item}){const build=useCallback((value:Item)=>()=>value.id+String(value.active),[]);const read=useMemo(()=>build(item),[build,item.id,item.active]);return <button onClick={()=>read()}/>}\n",
    1,
  ],
  [
    "opposed-delayed-missing-member",
    "import {useCallback,useMemo} from 'react';type Item={id:string;active:boolean};export function Panel({item}:{item:Item}){const build=useCallback((value:Item)=>()=>value.id+String(value.active),[]);const read=useMemo(()=>build(item),[build,item.id]);return <button onClick={()=>read()}/>}\n",
    1,
  ],
  [
    "opposed-whole-value-escape",
    "import {useCallback,useMemo} from 'react';type Item={id:string;active:boolean};export function Panel({item,deliver}:{item:Item;deliver:(v:Item)=>void}){const build=useCallback((value:Item)=>()=>deliver(value),[deliver]);const read=useMemo(()=>build(item),[build,item.id,deliver]);return <button onClick={read}/>}\n",
    1,
  ],
  [
    "opposed-computed-field",
    "import {useCallback,useMemo} from 'react';type Item={id:string;active:boolean};export function Panel({item,field}:{item:Item;field:keyof Item}){const build=useCallback((value:Item)=>()=>value[field],[field]);const read=useMemo(()=>build(item),[build,item.id,field]);return <button onClick={()=>read()}/>}\n",
    1,
  ],
  [
    "opposed-live-layout-mutation",
    "import {useCallback,useLayoutEffect,useMemo,useState} from 'react';type Item={id:string};export function Panel({item}:{item:Item}){const [tick,setTick]=useState(0);useLayoutEffect(()=>{item.id=String(tick)},[item,tick]);const build=useCallback((value:Item)=>()=>value.id,[]);const read=useMemo(()=>build(item),[build,item.id]);return <button onClick={()=>{setTick(tick+1);read()}}/>}\n",
    1,
  ],
  [
    "opposed-unknown-eager-provider",
    "import {useCallback,useMemo} from 'react';type Item={id:string;active:boolean};export function Panel({item,run}:{item:Item;run:(cb:()=>Item)=>unknown}){const build=useCallback((value:Item)=>run(()=>value),[run]);const result=useMemo(()=>build(item),[build,item.id,run]);return <output>{String(result)}</output>}\n",
    1,
  ],
  [
    "positive-returned-memo-helper",
    "import {useMemo} from 'react';\ntype Item={id:string;active:boolean};\nfunction useActions(){return useMemo(()=>{const build=(item:Item)=>()=>item.id+String(item.active);return {build}},[])}\nexport function Panel({item}:{item:Item}){const {build}=useActions();const read=useMemo(()=>build(item),[build,item.id,item.active]);return <button onClick={()=>read()}/>}\n",
    0,
  ],
  [
    "opposed-earlier-return-alternate",
    "import {useMemo} from 'react';\ntype Item={id:string;secret:string};\nfunction useActions(){const mode=true;return useMemo(()=>{if(mode){const build=(item:Item)=>()=>item.secret;return {build}}const build=(item:Item)=>()=>item.id;return {build}},[mode])}\nexport function Panel({item}:{item:Item}){const {build}=useActions();const read=useMemo(()=>build(item),[build,item.id]);return <button onClick={()=>read()}/>}\n",
    1,
  ],
  [
    "opposed-dynamic-local-member",
    "import {useMemo} from 'react';\ntype Item={id:string;secret:string};\nfunction useActions(){return useMemo(()=>{const build=(task:Item)=>()=>{void task.id;return eval('task.secret')};return {build}},[])}\nexport function Panel({item}:{item:Item}){const {build}=useActions();const read=useMemo(()=>build(item),[build,item.id]);return <button onClick={()=>read()}/>}\n",
    1,
  ],
] as const;

describe("dependencies read by memoized local hook helpers", () => {
  describe.each(["curated", "upstream"])("%s mode", (portedRuleMode) => {
    it.each(cases)("%s", (_name, source, count) => {
      const result = runRule(exhaustiveDeps, source, {
        settings: { "react-doctor": { portedRuleMode } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(count);
    });
  });
});
