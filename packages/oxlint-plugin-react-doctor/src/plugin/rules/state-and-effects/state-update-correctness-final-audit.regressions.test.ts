import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";
import { noMutateThenSetOrReturnSameReference } from "./no-mutate-then-set-or-return-same-reference.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";
import { noSpreadPropsOverDefaultsClobbersWithUndefined } from "./no-spread-props-over-defaults-clobbers-with-undefined.js";
import { noWholeObjectDepWithMemberReads } from "./no-whole-object-dep-with-member-reads.js";

describe("state update correctness final audit regressions", () => {
  it("invalidates a conditional member repair after a later unsafe write", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};if(merged.width==null)merged.width=1;merged.width=props.width;return merged.width*2}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a conditional alias of original state as a fresh reassignment", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[,setItems]=useState([]);setItems(items=>{const maybe=flag?items:[];items=maybe;items.push(1);return items})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles concise updater sequences and conditional direct setter values", () => {
    const concise = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setItems]=useState([]);setItems(items=>(items.push(1),items))}",
    );
    const direct = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[items,setItems]=useState([]);items.push(1);setItems(flag?items:[...items])}",
    );
    expect(concise.diagnostics).toHaveLength(1);
    expect(direct.diagnostics).toHaveLength(1);
  });

  it("does not report when an updater returns a fresh reassigned reference", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setItems]=useState([]);setItems(items=>{items.push(1);items=[...items];return items})}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps branch-heavy same-reference analysis bounded", () => {
    const branchCount = 400;
    const branches = Array.from(
      { length: branchCount },
      (_, branchIndex) =>
        `if(flags[${branchIndex}])items.push(${branchIndex});if(flags[${branchIndex}])return [...items];`,
    ).join("");
    const start = performance.now();
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      `const C=({flags})=>{const[,setItems]=useState([]);setItems(items=>{${branches}return [...items]})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(5_000);
  });

  it("tracks external receivers returned into fresh local containers", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(x=>{const box={store:getStore()};box.store.setItem('x',x);return x+1})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer callback impurity from an on-prefixed name", () => {
    const memberCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=(props)=>{const[,setRows]=useState([]);setRows(rows=>{rows.forEach(props.onVisit);return rows})}",
    );
    const arrayFrom = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>Array.from(rows,onVisit))}",
    );
    expect(memberCallback.diagnostics).toHaveLength(0);
    expect(arrayFrom.diagnostics).toHaveLength(0);
  });

  it("requires latest-write proof for state mirror refs", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const ref=useRef(open);ref.current=open;ref.current=false;useEffect(()=>queueMicrotask(()=>{if(ref.current===open)setOpen(!open)}),[open])}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects listener callbacks outside syntactically direct effect bodies", () => {
    const eventHandler = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const install=()=>document.addEventListener('x',()=>setOpen(!open));return <button onClick={install}/>}",
    );
    const effectHelper = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const install=()=>document.addEventListener('x',()=>setOpen(!open));useEffect(()=>install(),[])}",
    );
    expect(eventHandler.diagnostics).toHaveLength(1);
    expect(effectHelper.diagnostics).toHaveLength(1);
  });

  it("does not accept cleanup for asynchronously installed registrations", () => {
    const result = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);useEffect(()=>{const toggle=()=>setOpen(!open);Promise.resolve().then(()=>document.addEventListener('click',toggle));return()=>document.removeEventListener('click',toggle)},[open])}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks props reads in escaped nested closures", () => {
    const timer = runRule(
      noWholeObjectDepWithMemberReads,
      "import{useCallback}from'react';const C=(props)=>{const callback=useCallback(()=>{setTimeout(()=>console.log(props.value),0)},[props]);return callback}",
    );
    const registration = runRule(
      noWholeObjectDepWithMemberReads,
      "import{useCallback}from'react';const C=(props)=>{const callback=useCallback(()=>{register(()=>console.log(props.value))},[props]);return callback}",
    );
    expect(timer.diagnostics).toHaveLength(1);
    expect(registration.diagnostics).toHaveLength(1);
  });

  it("recognizes a proven safe trailing object spread", () => {
    const result = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const finalValues={width:50};const C=(props:Props)=>{const merged={...defaults,...props,...finalValues};return merged.width*2}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("correlates mutually exclusive literal discriminants", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({mode}:{mode:'mutate'|'return'|'copy'})=>{const[,setItems]=useState([]);setItems(items=>{if(mode==='mutate')items.push(1);if(mode==='return')return items;return [...items]})}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume updater parameters are arrays from method names", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setQueue]=useState({map(_callback){return this}});setQueue(queue=>queue.map(onVisit))}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses last-write semantics for fresh object methods", () => {
    const finalLocal = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>{const callbacks={onVisit,onVisit(){}};callbacks.onVisit(rows[0]);return rows})}",
    );
    const finalExternal = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>{const callbacks={onVisit(){},onVisit};callbacks.onVisit(rows[0]);return rows})}",
    );
    expect(finalLocal.diagnostics).toHaveLength(0);
    expect(finalExternal.diagnostics).toHaveLength(1);
  });

  it("detects known global side effects and schedulers", () => {
    const fetchCall = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(x=>{fetch('/api');return x+1})}",
    );
    const scheduler = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setX]=useState(0);setX(x=>{queueMicrotask(()=>onVisit(x));return x+1})}",
    );
    expect(fetchCall.diagnostics).toHaveLength(1);
    expect(scheduler.diagnostics).toHaveLength(1);
  });

  it("invalidates shared predicate correlations after a write", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=({flag})=>{const[,setItems]=useState([]);setItems(items=>{if(flag)items.push(1);flag=false;if(!flag)return items;return [...items]})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks original aliases across parameter reassignment", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setItems]=useState([]);setItems(items=>{const original=items;items=[];original.push(1);return original})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a fresh reassignment inside the same try block", () => {
    const result = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setItems]=useState([]);setItems(items=>{try{items=[...items];items.push(1);return items}catch{return []}})}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes exact Object.assign mutations and return values", () => {
    const updater = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[,setValue]=useState({});setValue(value=>{Object.assign(value,{x:1});return value})}",
    );
    const direct = runRule(
      noMutateThenSetOrReturnSameReference,
      "const C=()=>{const[value,setValue]=useState({});setValue(Object.assign(value,{x:1}))}",
    );
    const shadowed = runRule(
      noMutateThenSetOrReturnSameReference,
      "const Object={assign:(target,next)=>({...target,...next})};const C=()=>{const[value,setValue]=useState({});setValue(Object.assign(value,{x:1}))}",
    );
    expect(updater.diagnostics).toHaveLength(1);
    expect(direct.diagnostics).toHaveLength(1);
    expect(shadowed.diagnostics).toHaveLength(0);
  });

  it("detects property writes to external updater receivers", () => {
    const assignment = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({store})=>{const[,setX]=useState(0);setX(x=>{store.value=x;return x+1})}",
    );
    const update = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({metrics})=>{const[,setX]=useState(0);setX(x=>{metrics.count++;return x+1})}",
    );
    const local = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(x=>{const next={value:x};next.value+=1;return next.value})}",
    );
    const stateAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState({value:0});setX(value=>{const draft=value;draft.value+=1;return draft})}",
    );
    const externalHelperArgument = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({store})=>{const[,setX]=useState(0);setX(value=>{const write=target=>{target.value=value};write(store);return value+1})}",
    );
    const localHelperArgument = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState({value:0});setX(value=>{const write=target=>{target.value+=1};write(value);return value})}",
    );
    const mixedHelperArguments = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({store})=>{const[,setX]=useState({value:0});setX(value=>{const write=target=>{target.value+=1};write(value);write(store);return value})}",
    );
    expect(assignment.diagnostics).toHaveLength(1);
    expect(update.diagnostics).toHaveLength(1);
    expect(local.diagnostics).toHaveLength(0);
    expect(stateAlias.diagnostics).toHaveLength(0);
    expect(externalHelperArgument.diagnostics).toHaveLength(1);
    expect(localHelperArgument.diagnostics).toHaveLength(0);
    expect(mixedHelperArguments.diagnostics).toHaveLength(1);
  });

  it("distinguishes proven nullish fallbacks from unknown fallbacks", () => {
    const safe = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{options?:{width:number}}const defaults={options:{width:1}};const C=(props:Props)=>{const merged={...defaults,...props};return (merged.options?.width??0)*2}",
    );
    const unknown = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};return (merged.width??getFallback())*2}",
    );
    expect(safe.diagnostics).toHaveLength(0);
    expect(unknown.diagnostics).toHaveLength(1);
  });

  it("follows scalar aliases through wrappers and assignments", () => {
    const wrapped = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};const width=merged.width;const alias=width as number;return alias*2}",
    );
    const assigned = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};const width=merged.width;let alias;alias=width;return alias*2}",
    );
    const overwritten = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};const width=merged.width;let alias;alias=width;alias=1;return alias*2}",
    );
    const conditionallyOverwritten = runRule(
      noSpreadPropsOverDefaultsClobbersWithUndefined,
      "interface Props{width?:number;safe:boolean}const defaults={width:1};const C=(props:Props)=>{const merged={...defaults,...props};const width=merged.width;let alias;alias=width;if(props.safe)alias=1;return alias*2}",
    );
    expect(wrapped.diagnostics).toHaveLength(1);
    expect(assigned.diagnostics).toHaveLength(1);
    expect(overwritten.diagnostics).toHaveLength(0);
    expect(conditionallyOverwritten.diagnostics).toHaveLength(1);
  });

  it("keeps whole-object dependencies for direct method receivers", () => {
    const directMethod = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";const Panel=(props)=>useMemo(()=>props.format(),[props])',
    );
    const nestedMethod = runRule(
      noWholeObjectDepWithMemberReads,
      'import{useMemo}from"react";const Panel=(props)=>useMemo(()=>props.user.format(),[props])',
    );
    expect(directMethod.diagnostics).toHaveLength(0);
    expect(nestedMethod.diagnostics).toHaveLength(1);
  });

  it("recognizes once callbacks and globalThis timers as deferred", () => {
    const once = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=({emitter})=>{const[open,setOpen]=useState(false);const run=()=>emitter.once('ready',()=>setOpen(!open));return <button onClick={run}/>}",
    );
    const globalTimer = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const run=()=>globalThis.setTimeout(()=>setOpen(!open),0);return <button onClick={run}/>}",
    );
    expect(once.diagnostics).toHaveLength(1);
    expect(globalTimer.diagnostics).toHaveLength(1);
  });

  it("does not treat synchronous thenables as deferred Promises", () => {
    const synchronousThenable = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const run=()=>({then(callback){callback()}}).then(()=>setOpen(!open));return <button onClick={run}/>}",
    );
    const promise = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const run=()=>Promise.resolve().then(()=>setOpen(!open));return <button onClick={run}/>}",
    );
    const deferredThenable = runRule(
      noBooleanToggleWithoutFunctionalUpdate,
      "const C=()=>{const[open,setOpen]=useState(false);const thenable={then(callback){setTimeout(callback,0)}};const run=()=>thenable.then(()=>setOpen(!open));return <button onClick={run}/>}",
    );
    expect(synchronousThenable.diagnostics).toHaveLength(0);
    expect(promise.diagnostics).toHaveLength(1);
    expect(deferredThenable.diagnostics).toHaveLength(1);
  });
});
