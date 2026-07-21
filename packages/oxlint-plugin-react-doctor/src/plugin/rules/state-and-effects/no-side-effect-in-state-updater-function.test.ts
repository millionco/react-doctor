import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

describe("no-side-effect-in-state-updater-function", () => {
  it("flags an external callback inside an exact useState updater", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onChange }) => { const [, setValue] = useState(0); setValue((previous) => { onChange(previous + 1); return previous + 1; }); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags side effects in executed concise expressions", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = () => { const [, setValue] = useState(0); setValue((previous) => (trackEvent(previous), previous + 1)); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows named updater and setter aliases", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onSave }) => { const [, setValue] = useState(0); const update = (previous) => { onSave(previous); return previous + 1; }; const commit = setValue; commit(update); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows synchronous inline and named callbacks", () => {
    const inlineResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onVisit }) => { const [, setRows] = useState([]); setRows((rows) => rows.map((row) => { onVisit(row); return row; })); };`,
    );
    const namedResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onVisit }) => { const [, setRows] = useState([]); const visit = (row) => { onVisit(row); return row; }; setRows((rows) => rows.map(visit)); };`,
    );
    expect(inlineResult.diagnostics).toHaveLength(1);
    expect(namedResult.diagnostics).toHaveLength(1);
  });

  it("follows a synchronously called named helper", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onChange }) => { const [, setValue] = useState(0); const publish = (value) => onChange(value); setValue((previous) => { publish(previous); return previous + 1; }); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports global schedulers in synchronously executed helpers", () => {
    const namedHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setValue]=useState(0);const schedule=()=>setTimeout(()=>{},0);setValue(value=>{schedule();return value+1})}",
    );
    const nestedHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setValue]=useState(0);const outer=()=>{const inner=()=>globalThis.queueMicrotask(()=>{});inner()};setValue(value=>{outer();return value+1})}",
    );
    const recursiveHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setValue]=useState(0);const schedule=count=>{if(count>0)return schedule(count-1);self.setTimeout(()=>{},0)};setValue(value=>{schedule(1);return value+1})}",
    );
    const synchronousCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setRows]=useState([]);setRows(rows=>rows.map(row=>{setTimeout(()=>{},0);return row}))}",
    );
    expect(namedHelper.diagnostics).toHaveLength(1);
    expect(nestedHelper.diagnostics).toHaveLength(1);
    expect(recursiveHelper.diagnostics).toHaveLength(1);
    expect(synchronousCallback.diagnostics).toHaveLength(1);
  });

  it("ignores schedulers in helpers that are not synchronously executed", () => {
    const uninvokedHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setValue]=useState(0);setValue(value=>{const schedule=()=>setTimeout(()=>{},0);return value+1})}",
    );
    const storedCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setValue]=useState(0);setValue(value=>({value,schedule:()=>setTimeout(()=>{},0)}))}",
    );
    const shadowedScheduler = runRule(
      noSideEffectInStateUpdaterFunction,
      "const setTimeout=callback=>callback();const C=()=>{const[,setValue]=useState(0);const schedule=()=>setTimeout(()=>{},0);setValue(value=>{schedule();return value+1})}",
    );
    const externalScheduler = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({scheduler})=>{const[,setValue]=useState(0);const schedule=()=>scheduler.start();setValue(value=>{schedule();return value+1})}",
    );
    expect(uninvokedHelper.diagnostics).toHaveLength(0);
    expect(storedCallback.diagnostics).toHaveLength(0);
    expect(shadowedScheduler.diagnostics).toHaveLength(0);
    expect(externalScheduler.diagnostics).toHaveLength(0);
  });

  it("does not treat a useReducer dispatcher as a state setter", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onDispatch }) => { const [, dispatch] = useReducer(reducer, 0); dispatch((previous) => { onDispatch(previous); return previous + 1; }); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat local useState and setter lookalikes as React", () => {
    const localHook = runRule(
      noSideEffectInStateUpdaterFunction,
      `const useState = (value) => [value, (updater) => updater(value)]; const [, setValue] = useState(0); setValue((previous) => { trackEvent(previous); return previous + 1; });`,
    );
    const localSetter = runRule(
      noSideEffectInStateUpdaterFunction,
      `const setValue = (updater) => updater(0); setValue((previous) => { trackEvent(previous); return previous + 1; });`,
    );
    expect(localHook.diagnostics).toHaveLength(0);
    expect(localSetter.diagnostics).toHaveLength(0);
  });

  it("uses receiver provenance to ignore local draft helpers", () => {
    const localReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = () => { const [, setValue] = useState({}); setValue((previous) => { const next = { ...previous, analytics: makeLocalRecorder() }; next.analytics.track("local"); return next; }); };`,
    );
    const externalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = () => { const [, setValue] = useState({}); const analytics = getAnalytics(); setValue((previous) => { analytics.track("external"); return previous; }); };`,
    );
    expect(localReceiver.diagnostics).toHaveLength(0);
    expect(externalReceiver.diagnostics).toHaveLength(1);
  });

  it("does not inspect deferred callbacks stored in state", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ onDismiss }) => { const [, setToast] = useState(null); setToast((previous) => ({ previous, dismiss: () => onDismiss() })); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report a resolved pure helper based only on its name", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = () => { const [, setValue] = useState(0); const trackValue = (value) => value + 1; setValue((previous) => trackValue(previous)); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags console calls, nested setters, and renamed callback props", () => {
    const consoleCall = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(p=>{console.log(p);return p+1})}",
    );
    const nestedSetter = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);const[,setY]=useState(0);setX(p=>{setY(p);return p+1})}",
    );
    const renamedCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange:change})=>{const[,setX]=useState(0);setX(p=>{change(p);return p+1})}",
    );
    expect(consoleCall.diagnostics).toHaveLength(1);
    expect(nestedSetter.diagnostics).toHaveLength(1);
    expect(renamedCallback.diagnostics).toHaveLength(1);
  });

  it("flags global object schedulers and fetch calls without matching shadowed objects", () => {
    const globalTimer = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(value=>{globalThis.setTimeout(()=>{},0);return value+1})}",
    );
    const windowFetch = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(value=>{window.fetch('/api');return value+1})}",
    );
    const workerFetch = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(value=>{self.fetch('/api');return value+1})}",
    );
    const shadowedGlobal = runRule(
      noSideEffectInStateUpdaterFunction,
      "const globalThis={setTimeout(){},fetch(){}};const C=()=>{const[,setX]=useState(0);setX(value=>{globalThis.setTimeout(()=>{},0);globalThis.fetch('/api');return value+1})}",
    );
    expect(globalTimer.diagnostics).toHaveLength(1);
    expect(windowFetch.diagnostics).toHaveLength(1);
    expect(workerFetch.diagnostics).toHaveLength(1);
    expect(shadowedGlobal.diagnostics).toHaveLength(0);
  });

  it("follows Promise and Array.from synchronous callbacks", () => {
    const promiseExecutor = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{new Promise(resolve=>{onChange(p);resolve(p)});return p})}",
    );
    const arrayMapper = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState([]);setX(p=>Array.from(p,x=>{onChange(x);return x}))}",
    );
    expect(promiseExecutor.diagnostics).toHaveLength(1);
    expect(arrayMapper.diagnostics).toHaveLength(1);
  });

  it("distinguishes fresh local receivers from external aliases", () => {
    const externalAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(p=>{const analytics=getAnalytics();analytics.track(p);return p})}",
    );
    const freshObject = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=()=>{const[,setX]=useState(0);setX(p=>{const local={track:value=>value};local.track(p);return p})}",
    );
    expect(externalAlias.diagnostics).toHaveLength(1);
    expect(freshObject.diagnostics).toHaveLength(0);
  });

  it("does not report writes to a fresh array returned by a resolved useCallback helper", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import React from "react";
const C=()=>{
  const[,setRows]=React.useState<Row[]>([]);
  const cloneRows=React.useCallback((rows:Row[])=>rows.map(row=>({...row})),[]);
  setRows(rows=>{const next=cloneRows(rows);next[0].name="Ada";next[0].items=[];return next});
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports writes through mapped elements that were not cloned", () => {
    const reusedElement = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const cloneRows=useCallback((rows:Row[])=>rows.map(row=>row),[]);setRows(rows=>{const next=cloneRows(rows);next[0].name="Ada";return next})}`,
    );
    const nestedObject = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const cloneRows=useCallback((rows:Row[])=>rows.map(row=>({...row})),[]);setRows(rows=>{const next=cloneRows(rows);next[0].profile.name="Ada";return next})}`,
    );
    const nestedArrayElement = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const cloneRows=useCallback((rows:Row[])=>rows.map(row=>({...row,items:[...row.items]})),[]);setRows(rows=>{const next=cloneRows(rows);next[0].items[0].name="Ada";return next})}`,
    );
    expect(reusedElement.diagnostics).toHaveLength(1);
    expect(nestedObject.diagnostics).toHaveLength(1);
    expect(nestedArrayElement.diagnostics).toHaveLength(1);
  });

  it("does not trust a fresh mapped array binding after reassignment", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const clone=useCallback((rows:Row[])=>rows.map(row=>({...row})),[]);setRows(rows=>{let next=clone(rows);next=rows;next[0].name="Ada";return next})}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows unreassigned mutable bindings and aliases of fresh mapped arrays", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const clone=useCallback((rows:Row[])=>rows.map(row=>({...row})),[]);setRows(rows=>{let next=clone(rows);const alias=next;alias[0].name="Ada";return alias})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a reassigned alias of a fresh mapped array", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const clone=useCallback((rows:Row[])=>rows.map(row=>({...row})),[]);setRows(rows=>{const next=clone(rows);let alias=next;alias=rows;alias[0].name="Ada";return alias})}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps unresolved clone results external and follows side effects in useCallback helpers", () => {
    const unresolvedClone = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{cloneRows}from"./rows";const C=()=>{const[,setRows]=useState<Row[]>([]);setRows(rows=>{const next=cloneRows(rows);next[0].name="Ada";return next})}`,
    );
    const invokedHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setX]=useState(0);const updateCache=useCallback(value=>{fetch("/track?value="+value)},[]);setX(value=>{updateCache(value);return value+1})}`,
    );
    const invokedMapCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useCallback,useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const cloneRows=useCallback((rows:Row[])=>rows.map(row=>{fetch("/track");return{...row}}),[]);setRows(rows=>cloneRows(rows))}`,
    );
    expect(unresolvedClone.diagnostics).toHaveLength(1);
    expect(invokedHelper.diagnostics).toHaveLength(1);
    expect(invokedMapCallback.diagnostics).toHaveLength(1);
  });

  it("propagates array provenance into untyped invoked helper parameters", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setRows]=useState<Row[]>([]);const update=rows=>rows.map(row=>{fetch("/track");return row});setRows(rows=>update(rows))}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not follow unreachable or reassigned local helpers", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);function track(){fetch("/track")}track=()=>{};setValue(value=>{if(false)track();true||track();return value;track()})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not follow callbacks on statically empty collections", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);setValue(value=>{[].map(()=>fetch("/map"));Array.from([],()=>fetch("/from"));return value})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not invoke referenced callbacks on statically empty collections", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);setValue(value=>{[].map(fetch);Array.from([],fetch);return value})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows exact local helpers invoked through Function and Reflect APIs", () => {
    const functionCall = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const publish=()=>fetch("/call");setValue(value=>{publish.call(null);return value})}`,
    );
    const functionApply = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const publish=()=>fetch("/apply");setValue(value=>{publish.apply(null,[]);return value})}`,
    );
    const reflectApply = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const publish=()=>fetch("/reflect");setValue(value=>{Reflect.apply(publish,null,[]);return value})}`,
    );
    expect(functionCall.diagnostics).toHaveLength(1);
    expect(functionApply.diagnostics).toHaveLength(1);
    expect(reflectApply.diagnostics).toHaveLength(1);
  });

  it("does not treat a shadowed Reflect apply helper as immediate execution", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const Reflect={apply:()=>{}};const C=()=>{const[,setValue]=useState(0);const publish=()=>fetch("/reflect");setValue(value=>{Reflect.apply(publish,null,[]);return value})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps mutated and spread object methods unresolved", () => {
    const overwrittenMethod = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>fetch("/old")};helpers.track=()=>{};setValue(value=>{helpers.track();return value})}`,
    );
    const unknownSpread = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({overrides})=>{const[,setValue]=useState(0);const helpers={track:()=>fetch("/old"),...overrides};setValue(value=>{helpers.track();return value})}`,
    );
    const exactMethod = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>fetch("/track")};setValue(value=>{helpers.track();return value})}`,
    );
    expect(overwrittenMethod.diagnostics).toHaveLength(0);
    expect(unknownSpread.diagnostics).toHaveLength(0);
    expect(exactMethod.diagnostics).toHaveLength(1);
  });

  it("follows an unconditional direct object-method replacement before the updater call", () => {
    const inlineUpdater = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>{}};helpers.track=()=>fetch("/track");setValue(value=>{helpers.track();return value})}`,
    );
    const namedUpdater = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{helpers.run();return value};helpers.run=()=>fetch("/track");setValue(update)}`,
    );
    const directFetch = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};helpers.run=fetch;setValue(value=>{helpers.run("/track");return value})}`,
    );
    const namedReplacement = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const publish=()=>fetch("/track");helpers.run=publish;setValue(value=>{helpers.run();return value})}`,
    );
    expect(inlineUpdater.diagnostics).toHaveLength(1);
    expect(namedUpdater.diagnostics).toHaveLength(1);
    expect(directFetch.diagnostics).toHaveLength(1);
    expect(namedReplacement.diagnostics).toHaveLength(1);
  });

  it("reanalyzes a reused updater against the object method effective at each invocation", () => {
    const becomesSideEffecting = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{helpers.run();return value};setValue(update);helpers.run=()=>trackEvent();setValue(update)}`,
    );
    const staysPure = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{helpers.run();return value};setValue(update);helpers.run=()=>{};setValue(update)}`,
    );
    const changesAfterInvocations = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{helpers.run();return value};setValue(update);setValue(update);helpers.run=()=>trackEvent()}`,
    );
    const typedReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{(helpers as any).run();return value};setValue(update);helpers.run=()=>trackEvent();setValue(update)}`,
    );
    const nonNullReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const update=value=>{helpers!.run();return value};setValue(update);helpers.run=()=>trackEvent();setValue(update)}`,
    );
    expect(becomesSideEffecting.diagnostics).toHaveLength(1);
    expect(staysPure.diagnostics).toHaveLength(0);
    expect(changesAfterInvocations.diagnostics).toHaveLength(0);
    expect(typedReceiver.diagnostics).toHaveLength(1);
    expect(nonNullReceiver.diagnostics).toHaveLength(1);
  });

  it("follows unconditional direct object-method replacements through stable const aliases", () => {
    const directAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const alias=helpers;alias.run=fetch;setValue(value=>{helpers.run("/track");return value})}`,
    );
    const aliasChain = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={run:()=>{}};const first=helpers;const second=first;second.run=()=>fetch("/track");setValue(value=>{first.run();return value})}`,
    );
    expect(directAlias.diagnostics).toHaveLength(1);
    expect(aliasChain.diagnostics).toHaveLength(1);
  });

  it("keeps mutable, escaped, and conditional object aliases unresolved", () => {
    const mutableAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>{}};let alias=helpers;alias.track=()=>fetch("/track");setValue(value=>{helpers.track();return value})}`,
    );
    const escapedAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({configure})=>{const[,setValue]=useState(0);const helpers={track:()=>{}};const alias=helpers;configure(alias);alias.track=()=>fetch("/track");setValue(value=>{helpers.track();return value})}`,
    );
    const conditionalAliasWrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({enabled})=>{const[,setValue]=useState(0);const helpers={track:()=>{}};const alias=helpers;if(enabled)alias.track=()=>fetch("/track");setValue(value=>{helpers.track();return value})}`,
    );
    expect(mutableAlias.diagnostics).toHaveLength(0);
    expect(escapedAlias.diagnostics).toHaveLength(0);
    expect(conditionalAliasWrite.diagnostics).toHaveLength(0);
  });

  it("uses the last unconditional object-method replacement", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>{}};helpers.track=()=>fetch("/stale");helpers.track=()=>{};setValue(value=>{helpers.track();return value})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps conditional and escaped object-method writes unresolved", () => {
    const conditionalWrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({enabled})=>{const[,setValue]=useState(0);const helpers={track:()=>{}};if(enabled)helpers.track=()=>fetch("/track");setValue(value=>{helpers.track();return value})}`,
    );
    const escapedObject = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({configure})=>{const[,setValue]=useState(0);const helpers={track:()=>{}};configure(helpers);setValue(value=>{helpers.track();return value})}`,
    );
    const postCallWrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>{}};setValue(value=>{helpers.track();helpers.track=()=>fetch("/later");return value})}`,
    );
    const postCallOverride = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={track:()=>fetch("/first")};setValue(value=>{helpers.track();helpers.track=()=>{};return value})}`,
    );
    expect(conditionalWrite.diagnostics).toHaveLength(0);
    expect(escapedObject.diagnostics).toHaveLength(0);
    expect(postCallWrite.diagnostics).toHaveLength(1);
    expect(postCallOverride.diagnostics).toHaveLength(2);
  });

  it("does not follow callbacks on stable empty const collections", () => {
    const directEmpty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const empty=[];setValue(value=>{empty.map(()=>fetch("/map"));Array.from(empty,()=>fetch("/from"));return value})}`,
    );
    const aliasedEmpty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const empty=[];const alias=empty;setValue(value=>{alias.map(fetch);return value})}`,
    );
    expect(directEmpty.diagnostics).toHaveLength(0);
    expect(aliasedEmpty.diagnostics).toHaveLength(0);
  });

  it("follows callbacks when an empty const collection may gain elements", () => {
    const mutatedEmpty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const empty=[];empty.push(1);setValue(value=>{empty.map(()=>fetch("/map"));return value})}`,
    );
    const indexedEmpty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const empty=[];empty[0]=1;setValue(value=>{empty.map(()=>fetch("/map"));return value})}`,
    );
    const escapedEmpty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({fill})=>{const[,setValue]=useState(0);const empty=[];fill(empty);setValue(value=>{empty.map(()=>fetch("/map"));return value})}`,
    );
    expect(mutatedEmpty.diagnostics).toHaveLength(1);
    expect(indexedEmpty.diagnostics).toHaveLength(1);
    expect(escapedEmpty.diagnostics).toHaveLength(1);
  });

  it("does not inspect unreachable calls or noncallback method arguments", () => {
    const unreachable = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{if(false)onChange(p);return p+1})}",
    );
    const mapThisArg = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState([]);setX(rows=>rows.map(x=>x,onChange))}",
    );
    expect(unreachable.diagnostics).toHaveLength(0);
    expect(mapThisArg.diagnostics).toHaveLength(0);
  });

  it("does not assume a locally defined custom map method invokes its callback synchronously", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);const queue={map(callback){void callback;return []}};setRows(rows=>queue.map(row=>{onVisit(row);return row}))}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer side effects from an on-prefixed collection callback", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>{rows.forEach(onVisit);return rows})}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer impurity from an on-prefixed predicate name", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onFilter})=>{const[,setRows]=useState([]);setRows(rows=>rows.filter(onFilter))}",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an external callback stored in a fresh local object and then invoked", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>{const callbacks={onVisit};callbacks.onVisit(rows[0]);return rows})}",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("distinguishes unknown callback scheduling from nested external receivers", () => {
    const unknownMap = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({queue,onVisit})=>{const[,setRows]=useState([]);setRows(rows=>queue.map(row=>{onVisit(row);return row}))}",
    );
    const nestedReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({analytics})=>{const[,setValue]=useState(0);setValue(value=>{const box={analytics};box.analytics.track(value);return value+1})}",
    );
    const memberCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=(props)=>{const[,setValue]=useState(0);setValue(value=>{const callbacks={onVisit:props.onVisit};callbacks.onVisit(value);return value+1})}",
    );
    expect(unknownMap.diagnostics).toHaveLength(0);
    expect(nestedReceiver.diagnostics).toHaveLength(1);
    expect(memberCallback.diagnostics).toHaveLength(1);
  });
});
