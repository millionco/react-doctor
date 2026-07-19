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

  it("flags external callbacks passed directly to synchronous collection methods", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      "const C=({onVisit})=>{const[,setRows]=useState([]);setRows(rows=>{rows.forEach(onVisit);return rows})}",
    );
    expect(result.diagnostics).toHaveLength(1);
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
