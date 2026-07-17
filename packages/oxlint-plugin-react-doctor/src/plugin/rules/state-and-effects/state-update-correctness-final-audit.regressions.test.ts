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
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("tracks external receivers returned into fresh local containers", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(x=>{const box={store:getStore()};box.store.setItem('x',x);return x+1})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("detects direct member and Array.from side-effect callbacks", () => {
    const memberCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=(props)=>{const[,setRows]=useState([]);setRows(rows=>{rows.forEach(props.onVisit);return rows})}",
    );
    const arrayFrom = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>Array.from(rows,onVisit))}",
    );
    expect(memberCallback.diagnostics).toHaveLength(1);
    expect(arrayFrom.diagnostics).toHaveLength(1);
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
});
