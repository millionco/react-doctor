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

  it("flags external collection mutations and ignores updater-local collections", () => {
    const externalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useRef,useState}from"react";const C=()=>{const cache=useRef(new Map());const[,setValue]=useState(0);setValue(previous=>{cache.current.set("value",previous);return previous+1})}`,
    );
    const updaterLocalReceivers = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{const next=new Map(previous);next.set("value",1);const seen=new Set();seen.add("value");seen.delete("value");seen.clear();new Map(previous).set("other",2);new Set().add("other");return next})}`,
    );
    const lazilyInitializedLocalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{let next=null;if(previous.size){if(!next)next=new Map(previous);next.set("value",1)}return next??previous})}`,
    );
    const nullishInitializedLocalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{let next=null;next??=new Map(previous);next.set("value",1);return next})}`,
    );
    const nullishInitializedExternalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache=null;const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{cache??=new Map(previous);cache.set("value",1);return previous})}`,
    );
    const undefinedInitializedLocalReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{let next=undefined;next=new Map(previous);next.set("value",1);return next})}`,
    );
    const shadowedUndefinedReceiver = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const undefined=getExternalMap();const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{let next=undefined;if(previous.size)next=new Map(previous);next.set("value",1);return next})}`,
    );
    const updaterLocalMutableBuilders = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState("");setValue(previous=>{const params=new URLSearchParams();params.set("value",previous);const headers=new Headers();headers.set("x-value",previous);const data=new FormData();data.set("value",previous);return params.toString()})}`,
    );
    const externalMutableBuilders = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const params=new URLSearchParams();const headers=new Headers();const data=new FormData();const C=()=>{const[,setValue]=useState("");setValue(previous=>{params.set("value",previous);headers.set("x-value",previous);data.set("value",previous);return previous})}`,
    );
    expect(externalReceiver.diagnostics).toHaveLength(1);
    expect(updaterLocalReceivers.diagnostics).toHaveLength(0);
    expect(lazilyInitializedLocalReceiver.diagnostics).toHaveLength(0);
    expect(nullishInitializedLocalReceiver.diagnostics).toHaveLength(0);
    expect(nullishInitializedExternalReceiver.diagnostics).toHaveLength(1);
    expect(undefinedInitializedLocalReceiver.diagnostics).toHaveLength(0);
    expect(shadowedUndefinedReceiver.diagnostics).toHaveLength(1);
    expect(updaterLocalMutableBuilders.diagnostics).toHaveLength(0);
    expect(externalMutableBuilders.diagnostics).toHaveLength(3);
  });

  it("flags append mutations on external platform builders only", () => {
    const externalPlatformBuilders = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const params=new URLSearchParams();const headers=new Headers();const headerAlias=headers;const data=new FormData();const C=()=>{const[,setValue]=useState("");setValue(previous=>{params.append("value",previous);headerAlias.append("x-value",previous);data.append("value",previous);return previous})}`,
    );
    const updaterLocalPlatformBuilders = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState("");setValue(previous=>{const params=new URLSearchParams();params.append("value",previous);const headers=new Headers();const headerAlias=headers;headerAlias.append("x-value",previous);const data=new FormData();data.append("value",previous);new Headers().append("x-direct",previous);return params.toString()})}`,
    );
    const customAppendLookalike = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const builder={append(_key,_value){}};const C=()=>{const[,setValue]=useState("");setValue(previous=>{builder.append("value",previous);return previous})}`,
    );
    const shadowedPlatformConstructor = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";class Headers{append(_key,_value){}}const headers=new Headers();const C=()=>{const[,setValue]=useState("");setValue(previous=>{headers.append("value",previous);return previous})}`,
    );
    expect(externalPlatformBuilders.diagnostics).toHaveLength(3);
    expect(updaterLocalPlatformBuilders.diagnostics).toHaveLength(0);
    expect(customAppendLookalike.diagnostics).toHaveLength(0);
    expect(shadowedPlatformConstructor.diagnostics).toHaveLength(0);
  });

  it("flags discarded setter callback props without treating local setter helpers as effects", () => {
    const directSetterProp = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({setGroupState})=>{const[,setOpen]=useState(false);setOpen(previous=>{setGroupState("group",{open:previous});return!previous})}`,
    );
    const renamedSetterProp = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({setMessages:updateMessages})=>{const[,setRequests]=useState([]);setRequests(previous=>{updateMessages(messages=>messages);return previous})}`,
    );
    const defaultedSetterProp = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const noop=()=>{};const C=({setGroupState=noop})=>{const[,setOpen]=useState(false);setOpen(previous=>{setGroupState("group",{open:previous});return!previous})}`,
    );
    const memberSetterProp = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=props=>{const[,setRequests]=useState([]);setRequests(previous=>{props.setMessages(previous);return previous})}`,
    );
    const localSetterHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const setFormatter=value=>value+1;setValue(previous=>setFormatter(previous))}`,
    );
    const localSetterMethod = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const helpers={setMessages:value=>value};const[,setValue]=useState(0);setValue(previous=>{helpers.setMessages(previous);return previous})}`,
    );
    expect(directSetterProp.diagnostics).toHaveLength(1);
    expect(renamedSetterProp.diagnostics).toHaveLength(1);
    expect(defaultedSetterProp.diagnostics).toHaveLength(1);
    expect(memberSetterProp.diagnostics).toHaveLength(1);
    expect(localSetterHelper.diagnostics).toHaveLength(0);
    expect(localSetterMethod.diagnostics).toHaveLength(0);
  });

  it("distinguishes module service objects from component-local object helpers", () => {
    const moduleServices = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const storage={save:value=>value};const analytics={track:value=>value};const helpers={setMessages:value=>value};const C=()=>{const[,setValue]=useState(0);setValue(previous=>{storage.save(previous);analytics.track(previous);helpers.setMessages(previous);return previous+1})}`,
    );
    const componentHelpers = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const storage={save:value=>value};const analytics={track:value=>value};const helpers={setMessages:value=>value};const[,setValue]=useState(0);setValue(previous=>{storage.save(previous);analytics.track(previous);helpers.setMessages(previous);return previous+1})}`,
    );
    const updaterHelpers = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);setValue(previous=>{const storage={save:value=>value};const analytics={track:value=>value};const helpers={setMessages:value=>value};storage.save(previous);analytics.track(previous);helpers.setMessages(previous);return previous+1})}`,
    );
    expect(moduleServices.diagnostics).toHaveLength(3);
    expect(componentHelpers.diagnostics).toHaveLength(0);
    expect(updaterHelpers.diagnostics).toHaveLength(0);
  });

  it("flags callbacks stored in prior state without flagging fresh local callbacks", () => {
    const priorStateCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setConfig]=useState({onClose:()=>{}});setConfig(previous=>{previous.onClose&&previous.onClose();return{...previous,onClose:()=>{}}})}`,
    );
    const aliasedPriorStateCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setConfig]=useState({onClose:()=>{}});setConfig(previous=>{const current=previous;current.onClose?.();return{...previous,onClose:()=>{}}})}`,
    );
    const freshLocalCallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setConfig]=useState({});setConfig(previous=>{const local={onClose:()=>{}};local.onClose();return previous})}`,
    );
    expect(priorStateCallback.diagnostics).toHaveLength(1);
    expect(aliasedPriorStateCallback.diagnostics).toHaveLength(1);
    expect(freshLocalCallback.diagnostics).toHaveLength(0);
  });

  it("keeps proven immutable date value methods pure inside updaters", () => {
    const calendarDateTime = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState([new CalendarDateTime(2025,1,29,14,30)]);setValue(previous=>{const current=previous[0]??new CalendarDateTime(2025,1,1);return[current.set({hour:1})]})}`,
    );
    const dayjsValue = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const calendarDateTimeFalsyFallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:new CalendarDateTime(2025,1,29,14,30)});setValue(previous=>({...previous,date:(previous.date||new CalendarDateTime(2025,1,1)).set({hour:1})}))}`,
    );
    const calendarDateTimeDeadFalsyFallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:new CalendarDateTime(2025,1,29,14,30)});setValue(previous=>({...previous,date:(previous.date||getMutableDate()).set({hour:1})}))}`,
    );
    const calendarDateTimeNullishLeft = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:new CalendarDateTime(2025,1,29,14,30)});setValue(previous=>({...previous,date:(null??previous.date).set({hour:1})}))}`,
    );
    expect([
      calendarDateTime.diagnostics.length,
      calendarDateTimeFalsyFallback.diagnostics.length,
      calendarDateTimeDeadFalsyFallback.diagnostics.length,
      calendarDateTimeNullishLeft.diagnostics.length,
    ]).toEqual([0, 0, 0, 0]);
    expect(dayjsValue.diagnostics).toHaveLength(0);
  });

  it("keeps scalar, factory, logical, and chained immutable date values pure", () => {
    const scalarDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(dayjs());setDate(previous=>previous.add(1,"month").set("date",1))}`,
    );
    const aliasedScalarDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(dayjs());setDate(previous=>{const current=previous??dayjs();return current.add(1,"month")})}`,
    );
    const directDayjsFactory = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(dayjs());setDate(()=>dayjs().add(1,"month").set("date",1))}`,
    );
    const aliasedDayjsFactories = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const factory=dayjs;const C=()=>{const[,setDate]=useState(dayjs());setDate(()=>{const localFactory=factory;return localFactory().add(1,"month")})}`,
    );
    const scalarCalendarDateTime = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setDate]=useState(new CalendarDateTime(2025,1,1));setDate(previous=>previous.add({months:1}).set({day:1}))}`,
    );
    const logicalCalendarDateTime = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setDate]=useState(new CalendarDateTime(2025,1,1));setDate(previous=>(previous??new CalendarDateTime(2025,1,1)).add({months:1}))}`,
    );
    expect([
      scalarDayjs.diagnostics.length,
      aliasedScalarDayjs.diagnostics.length,
      directDayjsFactory.diagnostics.length,
      aliasedDayjsFactories.diagnostics.length,
      scalarCalendarDateTime.diagnostics.length,
      logicalCalendarDateTime.diagnostics.length,
    ]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("ignores statically unreachable prior state setter calls", () => {
    const runDayjsPriorSetter = (priorSetter: string) =>
      runRule(
        noSideEffectInStateUpdaterFunction,
        `import dayjs from"dayjs";import{useState}from"react";const C=({condition})=>{const[,setDate]=useState(dayjs());${priorSetter};setDate(previous=>previous.add(1,"month").set("date",1))}`,
      );
    const unreachableIf = runDayjsPriorSetter(`if(false)setDate(getMutableDate())`);
    const unreachableAlternate = runDayjsPriorSetter(
      `if(true)void 0;else setDate(getMutableDate())`,
    );
    const unreachableAnd = runDayjsPriorSetter(`false&&setDate(getMutableDate())`);
    const unreachableOr = runDayjsPriorSetter(`true||setDate(getMutableDate())`);
    const unreachableConditionalConsequent = runDayjsPriorSetter(
      `false?setDate(getMutableDate()):void 0`,
    );
    const unreachableConditionalAlternate = runDayjsPriorSetter(
      `true?void 0:setDate(getMutableDate())`,
    );
    const nestedUnreachableConditional = runDayjsPriorSetter(
      `true?(false?setDate(getMutableDate()):void 0):setDate(getMutableDate())`,
    );
    const reachableConditional = runDayjsPriorSetter(`if(condition)setDate(getMutableDate())`);
    const reachableAnd = runDayjsPriorSetter(`true&&setDate(getMutableDate())`);
    const reachableConditionalConsequent = runDayjsPriorSetter(
      `true?setDate(getMutableDate()):void 0`,
    );
    const reachableConditionalAlternate = runDayjsPriorSetter(
      `false?void 0:setDate(getMutableDate())`,
    );
    expect([
      unreachableIf.diagnostics.length,
      unreachableAlternate.diagnostics.length,
      unreachableAnd.diagnostics.length,
      unreachableOr.diagnostics.length,
      unreachableConditionalConsequent.diagnostics.length,
      unreachableConditionalAlternate.diagnostics.length,
      nestedUnreachableConditional.diagnostics.length,
    ]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(reachableConditional.diagnostics.length).toBeGreaterThan(0);
    expect(reachableAnd.diagnostics.length).toBeGreaterThan(0);
    expect(reachableConditionalConsequent.diagnostics.length).toBeGreaterThan(0);
    expect(reachableConditionalAlternate.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not trust scalar and chained immutable date lookalikes", () => {
    const mutableScalarDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{void dayjs;const[,setDate]=useState(getMutableDate());setDate(previous=>previous.add(1,"month").set("date",1))}`,
    );
    const replacedScalarDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(dayjs());setDate(getMutableDate());setDate(previous=>previous.add(1,"month").set("date",1))}`,
    );
    const mutableScalarCalendarDateTime = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{void CalendarDateTime;const[,setDate]=useState(getMutableDate());setDate(previous=>previous.add({months:1}).set({day:1}))}`,
    );
    expect(mutableScalarDayjs.diagnostics.length).toBeGreaterThan(0);
    expect(replacedScalarDayjs.diagnostics.length).toBeGreaterThan(0);
    expect(mutableScalarCalendarDateTime.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps unreassigned aliases of CalendarDateTime values pure", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState([new CalendarDateTime(2025,1,29,14,30)]);setValue(previous=>{let current=previous[0]??new CalendarDateTime(2025,1,1);const alias=current;return[alias.set({hour:1})]})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps directly accessed CalendarDateTime state members pure", () => {
    const arrayMember = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState([new CalendarDateTime(2025,1,29,14,30)]);setValue(previous=>[previous[0].set({hour:1})])}`,
    );
    const objectMember = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:new CalendarDateTime(2025,1,29,14,30)});setValue(previous=>({...previous,date:previous.date.set({hour:1})}))}`,
    );
    expect([arrayMember.diagnostics.length, objectMember.diagnostics.length]).toEqual([0, 0]);
  });

  it("keeps official Day.js static factory values pure", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import utc from"dayjs/plugin/utc";import{useState}from"react";dayjs.extend(utc);const C=()=>{const[,setDate]=useState({utc:dayjs.utc(),unix:dayjs.unix(0)});setDate(previous=>({...previous,utc:previous.utc.add(1,"month"),unix:previous.unix.set("month",1)}))}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps lazy-initialized and aliased Day.js values pure", () => {
    const lazyInitializer = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(()=>({selectedMonth:dayjs()}));setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const blockLazyInitializer = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState(()=>{return{selectedMonth:dayjs()}});setDate(previous=>{const selectedMonth=previous.selectedMonth;const alias=selectedMonth;return{...previous,selectedMonth:alias.set("month",1)}})}`,
    );
    expect(lazyInitializer.diagnostics).toHaveLength(0);
    expect(blockLazyInitializer.diagnostics).toHaveLength(0);
  });

  it("does not trust immutable date lookalikes or Day.js with badMutable", () => {
    const localCalendarDateTime = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";class CalendarDateTime{set(fields){Object.assign(this,fields);return this}}const C=()=>{const[,setValue]=useState([new CalendarDateTime()]);setValue(previous=>{const current=previous[0]??new CalendarDateTime();return[current.set({hour:1})]})}`,
    );
    const unrelatedDateFactory = runRule(
      noSideEffectInStateUpdaterFunction,
      `import createDate from"./mutable-date";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:createDate()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const mutableDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const unusedBadMutable = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";import{useState}from"react";const C=()=>{void badMutable;const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const mutableLazyAliasedDayjs = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";import{useState}from"react";dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState(()=>({selectedMonth:dayjs()}));setDate(previous=>{const selectedMonth=previous.selectedMonth;return{...previous,selectedMonth:selectedMonth.add(1,"month")}})}`,
    );
    const reassignedAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate(previous=>{let selectedMonth=previous.selectedMonth;selectedMonth=getMutableDate();return{...previous,selectedMonth:selectedMonth.add(1,"month")}})}`,
    );
    const reassignedCalendarDateTimeAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState([new CalendarDateTime(2025,1,29,14,30)]);setValue(previous=>{let current=previous[0]??new CalendarDateTime(2025,1,1);current=getMutableDate();return[current.set({hour:1})]})}`,
    );
    const unprovenCalendarDateTimeMember = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{void CalendarDateTime;const[,setValue]=useState({date:getMutableDate()});setValue(previous=>({...previous,date:previous.date.set({hour:1})}))}`,
    );
    const unprovenCalendarDateTimeNullishFallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:getMutableDate()});setValue(previous=>({...previous,date:(previous.date??new CalendarDateTime(2025,1,1)).set({hour:1})}))}`,
    );
    const unprovenCalendarDateTimeFalsyFallback = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:getMutableDate()});setValue(previous=>({...previous,date:(previous.date||new CalendarDateTime(2025,1,1)).set({hour:1})}))}`,
    );
    const unrelatedCalendarDateTimeLogicalOperator = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:getMutableDate()});setValue(previous=>({...previous,date:(previous.date&&new CalendarDateTime(2025,1,1)).set({hour:1})}))}`,
    );
    const mutableStaticDayjsFactory = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import badMutable from"dayjs/plugin/badMutable";import utc from"dayjs/plugin/utc";import{useState}from"react";dayjs.extend(utc);dayjs.extend(badMutable);const C=()=>{const[,setDate]=useState({selectedMonth:dayjs.utc()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    const replacedCalendarDateTimeMember = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{CalendarDateTime}from"@internationalized/date";import{useState}from"react";const C=()=>{const[,setValue]=useState({date:new CalendarDateTime(2025,1,29,14,30)});setValue({date:getMutableDate()});setValue(previous=>({...previous,date:previous.date.set({hour:1})}))}`,
    );
    const replacedDayjsMember = runRule(
      noSideEffectInStateUpdaterFunction,
      `import dayjs from"dayjs";import{useState}from"react";const C=()=>{const[,setDate]=useState({selectedMonth:dayjs()});setDate({selectedMonth:getMutableDate()});setDate(previous=>({...previous,selectedMonth:previous.selectedMonth.add(1,"month")}))}`,
    );
    expect(localCalendarDateTime.diagnostics).toHaveLength(1);
    expect(unrelatedDateFactory.diagnostics).toHaveLength(1);
    expect(mutableDayjs.diagnostics).toHaveLength(1);
    expect(unusedBadMutable.diagnostics).toHaveLength(0);
    expect(mutableLazyAliasedDayjs.diagnostics).toHaveLength(1);
    expect(reassignedAlias.diagnostics).toHaveLength(1);
    expect(reassignedCalendarDateTimeAlias.diagnostics).toHaveLength(1);
    expect(unprovenCalendarDateTimeMember.diagnostics).toHaveLength(1);
    expect(unprovenCalendarDateTimeNullishFallback.diagnostics).toHaveLength(1);
    expect(unprovenCalendarDateTimeFalsyFallback.diagnostics).toHaveLength(1);
    expect(unrelatedCalendarDateTimeLogicalOperator.diagnostics).toHaveLength(1);
    expect(mutableStaticDayjsFactory.diagnostics).toHaveLength(1);
    expect([
      replacedCalendarDateTimeMember.diagnostics.length,
      replacedDayjsMember.diagnostics.length,
    ]).toEqual([1, 1]);
  });

  it("ignores setter-shaped mutators on updater-local built-ins and factory results", () => {
    const localBuiltIns = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);setValue(previous=>{const date=new Date(previous);date.setTime(previous);const view=new DataView(new ArrayBuffer(8));view.setUint8(0,previous);const bytes=new Uint8Array(8);bytes.set([previous]);return previous+1})}`,
    );
    const chainedLazyContainer = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{let draft;const next=(draft??=new Map(previous));next.set("value",1);return next})}`,
    );
    const localFactoryResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{const createDraft=()=>new Map(previous);const next=createDraft();next.set("value",1);createDraft().set("other",2);return next})}`,
    );
    const externalDate = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const date=new Date();const C=()=>{const[,setValue]=useState(0);setValue(previous=>{date.setTime(previous);return previous+1})}`,
    );
    const externalFactoryResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const cache=new Map();const getCache=()=>cache;const C=()=>{const[,setValue]=useState(0);setValue(previous=>{const next=getCache();next.set("value",previous);return previous+1})}`,
    );
    expect(localBuiltIns.diagnostics).toHaveLength(0);
    expect(chainedLazyContainer.diagnostics).toHaveLength(0);
    expect(localFactoryResult.diagnostics).toHaveLength(0);
    expect(externalDate.diagnostics).toHaveLength(1);
    expect(externalFactoryResult.diagnostics).toHaveLength(1);
  });

  it("keeps property writes on proven fresh parser results local", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const parseHSL=value=>({h:0,s:0,l:Number(value)});const C=()=>{const[,setTheme]=useState({color:"0"});setTheme(previous=>{const current=parseHSL(previous.color);current.h=1;return{...previous,color:String(current.h)}})}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires chained fresh-container assignments to target execution-local bindings", () => {
    const externalDirectAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache;const C=()=>{const[,setValue]=useState(0);setValue(previous=>{(cache=new Map()).set("value",previous);return previous+1})}`,
    );
    const externalLazyAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache;const C=()=>{const[,setValue]=useState(0);setValue(previous=>{(cache??=new Map()).set("value",previous);return previous+1})}`,
    );
    const externalAssignmentAlias = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache;const C=()=>{const[,setValue]=useState(0);setValue(previous=>{const next=(cache=new Map());next.set("value",previous);return previous+1})}`,
    );
    const externalAssignmentFactory = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache;const C=()=>{const[,setValue]=useState(0);setValue(previous=>{const createDraft=()=>cache=new Map();createDraft().set("value",previous);return previous+1})}`,
    );
    expect(externalDirectAssignment.diagnostics).toHaveLength(1);
    expect(externalLazyAssignment.diagnostics).toHaveLength(1);
    expect(externalAssignmentAlias.diagnostics).toHaveLength(1);
    expect(externalAssignmentFactory.diagnostics).toHaveLength(1);
  });

  it("accepts execution-local assignments from proven fresh-container factories", () => {
    const assignedFactoryResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{const createDraft=()=>new Map(previous);let draft=null;draft=createDraft();draft.set("value",1);return draft})}`,
    );
    const chainedFactoryResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{const createDraft=()=>new Map(previous);let draft;const next=(draft??=createDraft());next.set("value",1);return next})}`,
    );
    const externalFactoryResult = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";let cache;const C=()=>{const[,setValues]=useState(new Map());setValues(previous=>{const createDraft=()=>new Map(previous);cache=createDraft();cache.set("value",1);return previous})}`,
    );
    expect(assignedFactoryResult.diagnostics).toHaveLength(0);
    expect(chainedFactoryResult.diagnostics).toHaveLength(0);
    expect(externalFactoryResult.diagnostics).toHaveLength(1);
  });

  it("keeps fresh collections assigned to updater-local properties local", () => {
    const chainedAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={...previous};(next.cache=new Map()).set("value",1);return next})}`,
    );
    const priorAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={...previous};next.cache=new Map();next.cache.set("value",1);return next})}`,
    );
    const localFactoryAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const createDraft=()=>new Map();const next={...previous};next.cache=createDraft();next.cache.set("value",1);return next})}`,
    );
    expect(chainedAssignment.diagnostics).toHaveLength(0);
    expect(priorAssignment.diagnostics).toHaveLength(0);
    expect(localFactoryAssignment.diagnostics).toHaveLength(0);
  });

  it("accounts for later object properties that can override fresh containers", () => {
    const earlierSpread = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={...previous,cache:new Map()};next.cache.set("value",1);return next})}`,
    );
    const laterSpread = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map(),...previous};next.cache.set("value",1);return next})}`,
    );
    const laterKnownProperty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map(),other:previous};next.cache.set("value",1);return next})}`,
    );
    const laterUnknownProperty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({key})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map(),[key]:previous.cache};next.cache.set("value",1);return next})}`,
    );
    expect(earlierSpread.diagnostics).toHaveLength(0);
    expect(laterSpread.diagnostics).toHaveLength(1);
    expect(laterKnownProperty.diagnostics).toHaveLength(0);
    expect(laterUnknownProperty.diagnostics).toHaveLength(1);
  });

  it("tracks property overwrites before mutating a fresh object property", () => {
    const dynamicOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({key})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};next[key]=previous.cache;next.cache.set("value",1);return next})}`,
    );
    const dynamicThenFresh = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({key})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};next[key]=previous.cache;next.cache=new Map();next.cache.set("value",1);return next})}`,
    );
    const objectAssignOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};Object.assign(next,previous);next.cache.set("value",1);return next})}`,
    );
    const objectAssignThenFresh = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};Object.assign(next,previous,{cache:new Map()});next.cache.set("value",1);return next})}`,
    );
    const freshThenObjectAssign = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={};Object.assign(next,{cache:new Map()},previous);next.cache.set("value",1);return next})}`,
    );
    const definePropertyOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};Object.defineProperty(next,"cache",{value:previous.cache});next.cache.set("value",1);return next})}`,
    );
    const definePropertyFresh = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};Object.defineProperty(next,"cache",{value:new Map()});next.cache.set("value",1);return next})}`,
    );
    const helperOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=()=>Object.assign(next,previous);overwrite();next.cache.set("value",1);return next})}`,
    );
    expect(dynamicOverwrite.diagnostics).toHaveLength(1);
    expect(dynamicThenFresh.diagnostics).toHaveLength(0);
    expect(objectAssignOverwrite.diagnostics).toHaveLength(1);
    expect(objectAssignThenFresh.diagnostics).toHaveLength(0);
    expect(freshThenObjectAssign.diagnostics).toHaveLength(1);
    expect(definePropertyOverwrite.diagnostics).toHaveLength(1);
    expect(definePropertyFresh.diagnostics).toHaveLength(0);
    expect(helperOverwrite.diagnostics).toHaveLength(1);
  });

  it("ignores overwrite mechanisms that provably leave the fresh property intact", () => {
    const staticOtherProperty = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};next.other=previous;Object.assign(next,{other:previous});Object.defineProperty(next,"other",{value:previous});next.cache.set("value",1);return next})}`,
    );
    const shadowedObject = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({Object})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};Object.assign(next,previous);next.cache.set("value",1);return next})}`,
    );
    const conditionalFreshOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};if(condition)next.cache=new Map();next.cache.set("value",1);return next})}`,
    );
    const dynamicFreshOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({key})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};next[key]=new Map();next.cache.set("value",1);return next})}`,
    );
    expect(staticOtherProperty.diagnostics).toHaveLength(0);
    expect(shadowedObject.diagnostics).toHaveLength(0);
    expect(conditionalFreshOverwrite.diagnostics).toHaveLength(0);
    expect(dynamicFreshOverwrite.diagnostics).toHaveLength(0);
  });

  it("replays only synchronously executed local helper mutations", () => {
    const parameterOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>Object.assign(target,previous);overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const parameterFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};const freshen=target=>Object.assign(target,{cache:new Map()});freshen(next);next.cache.set("value",1);return next})}`,
    );
    const asyncBeforeSuspension = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async()=>{Object.assign(next,previous);await 0};overwrite();next.cache.set("value",1);return next})}`,
    );
    const asyncAfterSuspension = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async()=>{await 0;Object.assign(next,previous)};overwrite();next.cache.set("value",1);return next})}`,
    );
    const asyncAfterConditionalSuspension = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async()=>{if(condition)await 0;Object.assign(next,previous)};overwrite();next.cache.set("value",1);return next})}`,
    );
    const asyncAfterUnreachableSuspension = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async()=>{if(false)await 0;Object.assign(next,previous)};overwrite();next.cache.set("value",1);return next})}`,
    );
    const generatorBody = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){Object.assign(next,previous)}overwrite();next.cache.set("value",1);return next})}`,
    );
    const parameterRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target={cache:previous.cache}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const conditionalParameterRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{if(condition)target={cache:new Map()};target.cache=previous.cache};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const defaultParameterOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=(target=next)=>Object.assign(target,previous);overwrite();next.cache.set("value",1);return next})}`,
    );
    expect(parameterOverwrite.diagnostics).toHaveLength(1);
    expect(parameterFreshen.diagnostics).toHaveLength(0);
    expect(asyncBeforeSuspension.diagnostics).toHaveLength(1);
    expect(asyncAfterSuspension.diagnostics).toHaveLength(0);
    expect(asyncAfterConditionalSuspension.diagnostics).toHaveLength(1);
    expect(asyncAfterUnreachableSuspension.diagnostics).toHaveLength(1);
    expect(generatorBody.diagnostics).toHaveLength(0);
    expect(parameterRebind.diagnostics).toHaveLength(0);
    expect(conditionalParameterRebind.diagnostics).toHaveLength(1);
    expect(defaultParameterOverwrite.diagnostics).toHaveLength(1);
  });

  it("tracks helper replay across suspension, iteration, and generator boundaries", () => {
    const conditionalSuspensionFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};const freshen=async target=>{if(condition)await 0;Object.assign(target,{cache:new Map()})};freshen(next);next.cache.set("value",1);return next})}`,
    );
    const trySuspensionFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};const freshen=async target=>{try{await 0}catch{}Object.assign(target,{cache:new Map()})};freshen(next);next.cache.set("value",1);return next})}`,
    );
    const repeatedHelperOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=()=>Object.assign(next,previous);for(let index=0;index<2;index++){next.cache.set("value",1);overwrite()}return next})}`,
    );
    const generatorNextOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){Object.assign(next,previous);yield}overwrite().next();next.cache.set("value",1);return next})}`,
    );
    const generatorAfterYield = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){yield;Object.assign(next,previous)}overwrite().next();next.cache.set("value",1);return next})}`,
    );
    const exhaustedGeneratorOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){yield;Object.assign(next,previous)}[...overwrite()];next.cache.set("value",1);return next})}`,
    );
    const forOfGeneratorOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){yield;Object.assign(next,previous)}for(const value of overwrite()){}next.cache.set("value",1);return next})}`,
    );
    const earlyExitGeneratorOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){Object.assign(next,previous);yield;Object.assign(next,{cache:new Map()})}for(const value of overwrite()){break}next.cache.set("value",1);return next})}`,
    );
    expect(conditionalSuspensionFreshen.diagnostics).toHaveLength(1);
    expect(trySuspensionFreshen.diagnostics).toHaveLength(1);
    expect(repeatedHelperOverwrite.diagnostics).toHaveLength(1);
    expect(generatorNextOverwrite.diagnostics).toHaveLength(1);
    expect(generatorAfterYield.diagnostics).toHaveLength(0);
    expect(exhaustedGeneratorOverwrite.diagnostics).toHaveLength(1);
    expect(forOfGeneratorOverwrite.diagnostics).toHaveLength(1);
    expect(earlyExitGeneratorOverwrite.diagnostics).toHaveLength(1);
  });

  it("evaluates suspension operands before stopping synchronous helper replay", () => {
    const awaitOperandOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{await Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const yieldOperandOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(target){yield Object.assign(target,previous)}overwrite(next).next();next.cache.set("value",1);return next})}`,
    );
    const forAwaitOperandOverwrite = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{for await(const value of(Object.assign(target,previous),[])){}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    expect(awaitOperandOverwrite.diagnostics).toHaveLength(1);
    expect(yieldOperandOverwrite.diagnostics).toHaveLength(1);
    expect(forAwaitOperandOverwrite.diagnostics).toHaveLength(1);
  });

  it("does not replay continuations dominated by a conditional suspension", () => {
    const conditionalAwaitBranch = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{if(condition){await 0;Object.assign(target,previous)}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const loopAwaitBranch = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({items})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{for(const item of items){await 0;Object.assign(target,previous)}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const conditionalYieldBranch = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(target){if(condition){yield;Object.assign(target,previous)}}overwrite(next).next();next.cache.set("value",1);return next})}`,
    );
    expect(conditionalAwaitBranch.diagnostics).toHaveLength(0);
    expect(loopAwaitBranch.diagnostics).toHaveLength(0);
    expect(conditionalYieldBranch.diagnostics).toHaveLength(0);
  });

  it("preserves active parameter provenance through alias-preserving rebinds", () => {
    const selfRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target=target;Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const originalAliasRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target=next;Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const conditionalExpressionRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition,other})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target=condition?target:other;Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const nullishRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({other})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target??=other;Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    expect(selfRebind.diagnostics).toHaveLength(1);
    expect(originalAliasRebind.diagnostics).toHaveLength(1);
    expect(conditionalExpressionRebind.diagnostics).toHaveLength(1);
    expect(nullishRebind.diagnostics).toHaveLength(1);
  });

  it("clears active parameter provenance after an unconditional distinct rebind", () => {
    const rebindAfterConditionalRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{if(condition)target={};target={};Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const rebindAfterConditionalSuspension = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{if(condition)await 0;target={};Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const truthyAndRebind = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({other})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target&&=other;Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    expect(rebindAfterConditionalRebind.diagnostics).toHaveLength(0);
    expect(rebindAfterConditionalSuspension.diagnostics).toHaveLength(0);
    expect(truthyAndRebind.diagnostics).toHaveLength(0);
  });

  it("stops replay after guaranteed suspension inside try statements", () => {
    const afterTry = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await 0}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const inFinally = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await 0}finally{Object.assign(target,previous)}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const inCatch = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({promise})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await promise}catch{Object.assign(target,previous)}};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const conditionallySkippedAwait = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{if(condition)throw 0;await 0}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const throwingAwaitOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await maybeThrow()}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const unresolvedAwaitOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await missingIdentifier}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const temporalDeadZoneOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await later}catch{}Object.assign(target,previous);const later=0};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const unresolvedVoidOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await void missingIdentifier}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const coerciveUnaryOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async(target,symbolValue)=>{try{await +symbolValue}catch{}Object.assign(target,previous)};overwrite(next,Symbol());next.cache.set("value",1);return next})}`,
    );
    const safePrefix = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{const marker=1;await 0}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const safeArrayOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await[]}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    const safeTemplateOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      'import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await``}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}',
    );
    const coerciveTemplateOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      'import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async(target,symbolValue)=>{try{await`${symbolValue}`}catch{}Object.assign(target,previous)};overwrite(next,Symbol());next.cache.set("value",1);return next})}',
    );
    const safeTypeofOperand = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=async target=>{try{await typeof missingIdentifier}catch{}Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    expect(afterTry.diagnostics).toHaveLength(0);
    expect(inFinally.diagnostics).toHaveLength(0);
    expect(inCatch.diagnostics).toHaveLength(0);
    expect(conditionallySkippedAwait.diagnostics).toHaveLength(1);
    expect(throwingAwaitOperand.diagnostics).toHaveLength(1);
    expect(unresolvedAwaitOperand.diagnostics).toHaveLength(1);
    expect(temporalDeadZoneOperand.diagnostics).toHaveLength(1);
    expect(unresolvedVoidOperand.diagnostics).toHaveLength(1);
    expect(coerciveUnaryOperand.diagnostics).toHaveLength(1);
    expect(safePrefix.diagnostics).toHaveLength(0);
    expect(safeArrayOperand.diagnostics).toHaveLength(0);
    expect(safeTemplateOperand.diagnostics).toHaveLength(0);
    expect(coerciveTemplateOperand.diagnostics).toHaveLength(1);
    expect(safeTypeofOperand.diagnostics).toHaveLength(0);
  });

  it("does not suspend at a statically empty delegated yield", () => {
    const emptyDelegatedYield = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};function* overwrite(){yield*[];Object.assign(next,previous)}overwrite().next();next.cache.set("value",1);return next})}`,
    );
    expect(emptyDelegatedYield.diagnostics).toHaveLength(1);
  });

  it("uses known object truthiness when replaying logical rebinds", () => {
    const logicalOrFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};const freshen=target=>{target=target||{};Object.assign(target,{cache:new Map()})};freshen(next);next.cache.set("value",1);return next})}`,
    );
    const nullishFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};const freshen=target=>{target=target??{};Object.assign(target,{cache:new Map()})};freshen(next);next.cache.set("value",1);return next})}`,
    );
    const logicalAndDetach = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=target=>{target=target&&{};Object.assign(target,previous)};overwrite(next);next.cache.set("value",1);return next})}`,
    );
    expect(logicalOrFreshen.diagnostics).toHaveLength(0);
    expect(nullishFreshen.diagnostics).toHaveLength(0);
    expect(logicalAndDetach.diagnostics).toHaveLength(0);
  });

  it("fully replays regular generator iteration without marking it conditional", () => {
    const forOfGeneratorFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}for(const value of freshen(next)){}next.cache.set("value",1);return next})}`,
    );
    const conditionalBreakBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}for(const value of freshen(next)){if(condition)break}next.cache.set("value",1);return next})}`,
    );
    const conditionalReturnBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}for(const value of freshen(next)){if(condition)return next}next.cache.set("value",1);return next})}`,
    );
    const switchBreakBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({value})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}for(const item of freshen(next)){switch(value){case 1:break}}next.cache.set("value",1);return next})}`,
    );
    const nestedLoopBreakBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}for(const item of freshen(next)){while(condition){break}}next.cache.set("value",1);return next})}`,
    );
    const labeledBreakBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}outer:for(const item of freshen(next)){if(condition)break outer}next.cache.set("value",1);return next})}`,
    );
    const outerBlockBreakBeforeFreshen = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}outer:{for(const item of freshen(next)){if(condition)break outer}}next.cache.set("value",1);return next})}`,
    );
    const outerBlockBreakSkippingUsage = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({condition})=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:previous.cache};function* freshen(target){yield;Object.assign(target,{cache:new Map()})}outer:{for(const item of freshen(next)){if(condition)break outer}next.cache.set("value",1)}return next})}`,
    );
    expect(forOfGeneratorFreshen.diagnostics).toHaveLength(0);
    expect(conditionalBreakBeforeFreshen.diagnostics).toHaveLength(1);
    expect(conditionalReturnBeforeFreshen.diagnostics).toHaveLength(0);
    expect(switchBreakBeforeFreshen.diagnostics).toHaveLength(0);
    expect(nestedLoopBreakBeforeFreshen.diagnostics).toHaveLength(0);
    expect(labeledBreakBeforeFreshen.diagnostics).toHaveLength(1);
    expect(outerBlockBreakBeforeFreshen.diagnostics).toHaveLength(1);
    expect(outerBlockBreakSkippingUsage.diagnostics).toHaveLength(0);
  });

  it("uses default parameter provenance for explicit undefined arguments", () => {
    const undefinedArgument = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=(target=next)=>Object.assign(target,previous);overwrite(undefined);next.cache.set("value",1);return next})}`,
    );
    const voidArgument = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=(target=next)=>Object.assign(target,previous);overwrite(void 0);next.cache.set("value",1);return next})}`,
    );
    const wrappedUndefinedArgument = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={cache:new Map()};const overwrite=(target=next)=>Object.assign(target,previous);overwrite(undefined as never);next.cache.set("value",1);return next})}`,
    );
    expect(undefinedArgument.diagnostics).toHaveLength(1);
    expect(voidArgument.diagnostics).toHaveLength(1);
    expect(wrappedUndefinedArgument.diagnostics).toHaveLength(1);
  });

  it("does not trust external or conditionally assigned collection properties", () => {
    const externalObject = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const cache={items:new Map()};const C=()=>{const[,setValue]=useState(0);setValue(previous=>{cache.items.set("value",previous);return previous+1})}`,
    );
    const externalAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const cache={};const C=()=>{const[,setValue]=useState(0);setValue(previous=>{cache.items=new Map();cache.items.set("value",previous);return previous+1})}`,
    );
    const conditionalAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={...previous};if(previous.ready)next.cache=new Map();next.cache.set("value",1);return next})}`,
    );
    const overwrittenAssignment = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState({});setValue(previous=>{const next={...previous};next.cache=new Map();next.cache=getExternalMap();next.cache.set("value",1);return next})}`,
    );
    const misleadingLocalFactoryName = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const externalCache=new Map();const C=()=>{const[,setValue]=useState({});setValue(previous=>{const createLocalCache=()=>externalCache;const next={...previous};next.cache=createLocalCache();next.cache.set("value",1);return next})}`,
    );
    expect(externalObject.diagnostics).toHaveLength(1);
    expect(externalAssignment.diagnostics).toHaveLength(2);
    expect(conditionalAssignment.diagnostics).toHaveLength(1);
    expect(overwrittenAssignment.diagnostics).toHaveLength(1);
    expect(misleadingLocalFactoryName.diagnostics).toHaveLength(1);
  });

  it("flags persistence and submission calls while following pure local name lookalikes", () => {
    const importedPersistence = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{saveColumnWidths}from"./storage";import{useState}from"react";const C=()=>{const[,setWidths]=useState({});setWidths(previous=>{saveColumnWidths("table",previous);return previous})}`,
    );
    const unresolvedSubmission = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const{submitFeedback}=useFeedback();const[,setMessages]=useState([]);setMessages(previous=>{submitFeedback(previous);return previous})}`,
    );
    const localPureHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const saveValue=value=>value+1;setValue(previous=>saveValue(previous))}`,
    );
    expect(importedPersistence.diagnostics).toHaveLength(1);
    expect(unresolvedSubmission.diagnostics).toHaveLength(1);
    expect(localPureHelper.diagnostics).toHaveLength(0);
  });

  it("keeps component-local object helpers local across handlers and effects", () => {
    const nestedHandler = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={saveValue:value=>value+1};const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const nestedEffect = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useEffect,useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={saveValue:value=>value+1};useEffect(()=>{setValue(previous=>helpers.saveValue(previous))},[]);return null}`,
    );
    expect(nestedHandler.diagnostics).toHaveLength(0);
    expect(nestedEffect.diagnostics).toHaveLength(0);
  });

  it("keeps object helpers outside the state owner conservatively external", () => {
    const moduleHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const helpers={saveValue:value=>value+1};const C=()=>{const[,setValue]=useState(0);const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const externalHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({helpers})=>{const[,setValue]=useState(0);const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const deferredFactoryHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const makeComponent=()=>{const helpers={saveValue:value=>value+1};return()=>{const[,setValue]=useState(0);const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}}`,
    );
    const nestedDeferredHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useEffect,useState}from"react";const C=()=>{const[,setValue]=useState(0);useEffect(()=>{const helpers={saveValue:value=>value+1};queueMicrotask(()=>setValue(previous=>helpers.saveValue(previous)))},[]);return null}`,
    );
    const localSideEffectingHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const helpers={saveValue:value=>{fetch("/track");return value+1}};const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const escapedLocalHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({configure})=>{const[,setValue]=useState(0);const helpers={saveValue:value=>value+1};configure(helpers);const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const replacedLocalHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({saveValue})=>{const[,setValue]=useState(0);const helpers={saveValue:value=>value+1};helpers.saveValue=saveValue;const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    const spreadLocalHelper = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=({overrides})=>{const[,setValue]=useState(0);const helpers={saveValue:value=>value+1,...overrides};const onClick=()=>setValue(previous=>helpers.saveValue(previous));return <button onClick={onClick}/>}`,
    );
    expect(moduleHelper.diagnostics).toHaveLength(1);
    expect(externalHelper.diagnostics).toHaveLength(1);
    expect(deferredFactoryHelper.diagnostics).toHaveLength(1);
    expect(nestedDeferredHelper.diagnostics).toHaveLength(1);
    expect(localSideEffectingHelper.diagnostics).toHaveLength(1);
    expect(escapedLocalHelper.diagnostics).toHaveLength(1);
    expect(replacedLocalHelper.diagnostics).toHaveLength(1);
    expect(spreadLocalHelper.diagnostics).toHaveLength(1);
  });

  it("flags async update calls that start a promise chain without flagging plain update helpers", () => {
    const asyncUpdate = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{updateChatMessageFeedback}from"./api";import{useState}from"react";const C=()=>{const[,setRequests]=useState([]);setRequests(previous=>{updateChatMessageFeedback(1,"up").then(()=>{});return previous})}`,
    );
    const plainUpdate = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{updateRecord}from"./model";import{useState}from"react";const C=()=>{const[,setValue]=useState(0);setValue(previous=>updateRecord(previous))}`,
    );
    const localAsyncUpdate = runRule(
      noSideEffectInStateUpdaterFunction,
      `import{useState}from"react";const C=()=>{const[,setValue]=useState(0);const updateRecord=value=>Promise.resolve(value);setValue(previous=>updateRecord(previous).then(value=>value+1))}`,
    );
    expect(asyncUpdate.diagnostics).toHaveLength(1);
    expect(plainUpdate.diagnostics).toHaveLength(0);
    expect(localAsyncUpdate.diagnostics).toHaveLength(0);
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

  it("does not inspect side effects in dead literal conditional arms", () => {
    const deadConsequent = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{false?onChange(p):void 0;return p+1})}",
    );
    const deadAlternate = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{true?void 0:onChange(p);return p+1})}",
    );
    const nestedDeadArms = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{true?(false?onChange(p):void 0):onChange(p);return p+1})}",
    );
    const liveArms = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onChange})=>{const[,setX]=useState(0);setX(p=>{true?onChange(p):void 0;false?void 0:onChange(p);return p+1})}",
    );
    expect(deadConsequent.diagnostics).toHaveLength(0);
    expect(deadAlternate.diagnostics).toHaveLength(0);
    expect(nestedDeadArms.diagnostics).toHaveLength(0);
    expect(liveArms.diagnostics).toHaveLength(2);
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

  it("flags callback props destructured from a props object inside the component body", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const Table = (props) => {
        const { onSelectedRowsChange } = props;
        const [, setSelectedRows] = useState([]);
        setSelectedRows((previous) => {
          const next = previous.filter(Boolean);
          if (next.length !== previous.length) onSelectedRowsChange(next);
          return next;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags defaulted callback props destructured inside the component body", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const noop = () => {};
      const Table = (props) => {
        const { onSelectedRowsChange = noop } = props;
        const [, setSelectedRows] = useState([]);
        setSelectedRows((previous) => {
          onSelectedRowsChange(previous);
          return previous;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "history.pushState(null, '', href)",
    "window.history.pushState(null, '', href)",
    "globalThis.history.replaceState(null, '', href)",
  ])("flags History API mutations inside an updater: %s", (mutation) => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ href }) => {
        const [, setParams] = useState(new URLSearchParams());
        setParams((previous) => {
          const next = new URLSearchParams(previous);
          ${mutation};
          return next;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const method = replace ? 'replaceState' : 'pushState'; window.history[method](null, '', href)",
    "window.history[replace ? 'replaceState' : 'pushState'](null, '', href)",
    "const suffix = 'State'; const method = 'push' + suffix; globalThis.history[method](null, '', href)",
  ])("flags statically finite computed History API mutations: %s", (mutation) => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ href, replace }) => {
        const [, setParams] = useState(new URLSearchParams());
        setParams((previous) => {
          const next = new URLSearchParams(previous);
          ${mutation};
          return next;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const method = replace ? 'go' : 'back'; window.history[method]()",
    "let method = 'pushState'; method = 'go'; window.history[method]()",
    "const method = getMethod(); window.history[method]()",
  ])("does not flag unknown or non-mutating computed History calls: %s", (mutation) => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ replace, getMethod }) => {
        const [, setValue] = useState(0);
        setValue((previous) => {
          ${mutation};
          return previous;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed History-like object", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      `const C = ({ href }) => {
        const history = { pushState() {} };
        const [, setParams] = useState(new URLSearchParams());
        setParams((previous) => {
          history.pushState(null, '', href);
          return previous;
        });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
