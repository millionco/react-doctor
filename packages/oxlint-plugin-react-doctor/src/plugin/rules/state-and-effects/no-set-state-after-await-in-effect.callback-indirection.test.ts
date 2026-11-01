import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface CallbackIndirectionCase {
  readonly name: string;
  readonly setup: string;
  readonly effect?: string;
  readonly cleanup?: string;
  readonly expected: number;
}

const cases: CallbackIndirectionCase[] = [
  {
    name: "keeps object execution predicate unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { const snapshot = readVersion(); await load(id); const guard = {latest: readVersion() === snapshot}; if (guard.latest) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps destructured execution predicate unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { const snapshot = readVersion(); await load(id); const {latest: guard} = {latest: readVersion() === snapshot}; if (guard) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps readonly comparison predicate alias unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { const snapshot = readVersion(); await load(id); const guard = readVersion() === snapshot; const saved = guard; if (saved) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps early return comparison unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { const snapshot = readVersion(); await load(id); if (readVersion() !== snapshot) return; setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps local reader container snapshots unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { const snapshot = [readVersion()]; await load(id); const latest = [readVersion()]; if (snapshot[0] === latest[0]) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps assigned local reader snapshots unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const run = useCallback(async () => { let snapshot; snapshot = readVersion(); await load(id); let latest; latest = readVersion(); if (snapshot === latest) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps computed Boolean ref writes unsupported",
    setup:
      "const generation = useRef(0); const readVersion = () => generation.current; const live = useRef(false); const run = useCallback(async () => { const snapshot = readVersion(); await load(id); live.current = readVersion() === snapshot; if (live.current) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps escaped Boolean ref predicates unsupported",
    setup:
      "const live = useRef(false); publish(live); const run = useCallback(async () => { await load(id); if (live.current) setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps extracted native reject completion unsupported",
    setup:
      "const {reject} = Promise; const run = useCallback(async () => { try { await reject(id); } catch { return; } setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps extracted native reject with default completion unsupported",
    setup:
      "const {reject = other} = Promise; const run = useCallback(async () => { try { await reject(id); } catch { return; } setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "preserves shadowed extracted reject completion",
    setup:
      "const Promise = {reject: () => load(id)}; const {reject} = Promise; const run = useCallback(async () => { await reject(); setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "preserves comparisons selecting awaited argument values",
    setup:
      "const run = useCallback(async () => { const result = await load(id === enabled ? id : enabled); setValue(result); }, [id]);",
    expected: 1,
  },
  {
    name: "preserves native Boolean state execution guards",
    setup:
      "const [active] = useState(false); const run = useCallback(async () => { await load(id); if (active) setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "keeps current reader array snapshots unsupported",
    setup:
      "const generation = useRef(0); const sequence = useRef(() => generation.current); const run = useCallback(async () => { const snapshot = [sequence.current()]; await load(id); const latest = [sequence.current()]; if (snapshot[0] === latest[0]) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps current reader object snapshots unsupported",
    setup:
      "const generation = useRef(0); const sequence = useRef(() => generation.current); const run = useCallback(async () => { const snapshot = {value: sequence.current()}; await load(id); const latest = {value: sequence.current()}; if (snapshot.value === latest.value) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps scalar current reader comparison unsupported",
    setup:
      "const generation = useRef(0); const sequence = useRef(() => generation.current); const run = useCallback(async () => { const snapshot = sequence.current(); await load(id); const latest = sequence.current(); if (snapshot === latest) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps mutable current reader transport unsupported",
    setup:
      "const generation = useRef(0); const sequence = useRef(() => generation.current); const run = useCallback(async () => { let snapshot; snapshot = sequence.current(); await load(id); let latest; latest = sequence.current(); if (snapshot === latest) setValue(id); }, [id]);",
    effect: "generation.current++; run();",
    expected: 0,
  },
  {
    name: "keeps assigned current snapshots unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { let snapshot; snapshot = sequence.current; await load(id); let latest; latest = sequence.current; if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps assigned current snapshot containers unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { let snapshot; snapshot = [sequence.current]; await load(id); let latest; latest = [sequence.current]; if (snapshot[0] === latest[0]) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps assigned current pattern captures unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { let snapshot; ({current: snapshot} = sequence); await load(id); let latest; ({current: latest} = sequence); if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps current snapshot default RHS unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { let snapshot; ({value: snapshot = sequence.current} = {}); await load(id); let latest; ({value: latest = sequence.current} = {}); if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "preserves direct current boolean write invalidation",
    setup:
      "const cancelled = useRef(false); const run = useCallback(async () => { await load(id); cancelled.current = false; if (!cancelled.current) setValue(id); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "preserves direct current callback result initializer",
    setup:
      "const loadValue = useCallback(async () => load(id), [id]); const loader = useRef(loadValue); const run = useCallback(async () => { const result = await loader.current(); setValue(result); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "keeps destructured current snapshot comparisons unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const {current: snapshot} = sequence; await load(id); const {current: latest} = sequence; if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps array-held current snapshots unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = [sequence.current]; await load(id); const latest = [sequence.current]; if (snapshot[0] === latest[0]) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps readonly aliases of current pattern captures unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const {current: snapshot} = sequence; const saved = snapshot; await load(id); const {current: latest} = sequence; if (saved === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps ref-mediated destructured current captures unsupported",
    setup:
      "const sequence = useRef(0); const callback = useCallback(async () => { const {current: snapshot} = sequence; await load(id); const {current: latest} = sequence; if (snapshot === latest) setValue(id); }, [id]); const run = useRef(callback); useEffect(() => { run.current = callback; }, [callback]);",
    effect: "sequence.current++; run.current();",
    expected: 0,
  },
  {
    name: "keeps object-held current snapshots unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = {value: sequence.current}; await load(id); const latest = {value: sequence.current}; if (snapshot.value === latest.value) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps resolved computed current capture unsupported",
    setup:
      'const sequence = useRef(0); const currentKey = "current"; const run = useCallback(async () => { const snapshot = sequence[currentKey]; await load(id); const latest = sequence[currentKey]; if (snapshot === latest) setValue(id); }, [id]);',
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps unresolved computed pattern capture unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const {[id]: snapshot} = sequence; await load(id); const {[id]: latest} = sequence; if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "preserves unrelated known-key local destructuring",
    setup:
      "const run = useCallback(async () => { const {value: unused} = {value: id}; await load(id); setValue(id); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "keeps read-snapshot current guard unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = sequence.current; await load(id); if (snapshot === sequence.current) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps ref-mediated read-snapshot guard unsupported",
    setup:
      "const sequence = useRef(0); const callback = useCallback(async () => { const snapshot = sequence.current; await load(id); if (snapshot === sequence.current) setValue(id); }, [id]); const run = useRef(callback); useEffect(() => { run.current = callback; }, [callback]);",
    effect: "sequence.current++; run.current();",
    expected: 0,
  },
  {
    name: "keeps readonly current comparison aliases unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = sequence.current; await load(id); const latest = sequence.current; if (snapshot === latest) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps rewritten counter comparisons unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = sequence.current; await load(id); sequence.current = snapshot; if (snapshot === sequence.current) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "keeps native rejection with catch return unsupported",
    setup:
      "const run = useCallback(async () => { try { await Promise.reject(id); } catch { return; } setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps native rejected await unsupported",
    setup:
      "const run = useCallback(async () => { await Promise.reject(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps readonly rejected promise alias unsupported",
    setup:
      "const run = useCallback(async () => { const rejected = Promise.reject(id); try { await rejected; } catch { return; } setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps readonly native Promise alias rejection unsupported",
    setup:
      "const promise = Promise; const run = useCallback(async () => { try { await promise.reject(id); } catch { return; } setValue(id); }, [id]);",
    effect: "run();",
    expected: 0,
  },
  {
    name: "keeps readonly native reject method alias unsupported",
    setup:
      "const reject = Promise.reject; const run = useCallback(async () => { try { await reject(id); } catch { return; } setValue(id); }, [id]);",
    effect: "run();",
    expected: 0,
  },
  {
    name: "keeps readonly bound native reject method unsupported",
    setup:
      "const reject = Promise.reject.bind(Promise); const run = useCallback(async () => { try { await reject(id); } catch { return; } setValue(id); }, [id]);",
    effect: "run();",
    expected: 0,
  },
  {
    name: "keeps Object.is snapshot comparison unsupported",
    setup:
      "const sequence = useRef(0); const run = useCallback(async () => { const snapshot = sequence.current; await load(id); if (Object.is(snapshot, sequence.current)) setValue(id); }, [id]);",
    effect: "sequence.current++; run();",
    expected: 0,
  },
  {
    name: "does not treat extracted native function as Promise namespace",
    setup:
      "const {resolve: promise} = Promise; promise.reject = () => load(id); const run = useCallback(async () => { await promise.reject(); setValue(id); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "does not infer native rejection from shadowed Promise alias",
    setup:
      "const Promise = {reject: () => load(id)}; const promise = Promise; const run = useCallback(async () => { await promise.reject(); setValue(id); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "does not infer native rejection from shadowed reject method alias",
    setup:
      "const Promise = {reject: () => load(id)}; const reject = Promise.reject; const run = useCallback(async () => { await reject(); setValue(id); }, [id]);",
    effect: "run();",
    expected: 1,
  },
  {
    name: "does not infer native rejection from shadowed Promise",
    setup:
      "const Promise = {reject: () => load(id)}; const run = useCallback(async () => { await Promise.reject(); setValue(id); }, [id]);",
    expected: 1,
  },

  {
    name: "reports memoized async reducer dispatch",
    setup:
      "const [state, dispatch] = useReducer((current, action) => action, null); const run = useCallback(async () => { const result = await load(id); dispatch(result); }, [id]);",
    expected: 1,
  },
  {
    name: "keeps replaced reducer provider unsupported",
    setup:
      "useReducer = other; const [state, dispatch] = useReducer((current, action) => action, null); const run = useCallback(async () => { await load(id); dispatch(id); }, [id]);",
    expected: 0,
  },
  {
    name: "keeps rebound reducer dispatcher unsupported",
    setup:
      "let [state, dispatch] = useReducer((current, action) => action, null); dispatch = other; const run = useCallback(async () => { await load(id); dispatch(id); }, [id]);",
    expected: 0,
  },
  {
    name: "direct immutable callback",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "transitive callback",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useCallback(() => loadValue(), [loadValue]);",
    expected: 1,
  },
  {
    name: "conditional closure selector",
    setup:
      "const loadFirst = useCallback(async () => { if (load) { await load(id); setValue(id); } }, [id]); const loadNext = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useCallback(() => enabled ? loadFirst() : loadNext(), [enabled, loadFirst, loadNext]);",
    expected: 1,
  },
  {
    name: "private initialized callback ref",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue);",
    effect: "run.current();",
    expected: 1,
  },
  {
    name: "ref refreshed with identical callback binding",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); useEffect(() => { run.current = loadValue; }, [loadValue]);",
    effect: "run.current();",
    expected: 1,
  },
  {
    name: "private plain callback ref",
    setup:
      "const loadValue = async () => { await load(id); setValue(id); }; const run = useRef(loadValue);",
    effect: "run.current();",
    expected: 1,
  },
  {
    name: "function value metadata and return carrier",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); loadValue.description = 'load'; const available = {loadValue}; const run = useCallback(() => loadValue(), [loadValue]);",
    expected: 1,
  },
  {
    name: "readonly scalar callback alias",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = loadValue;",
    expected: 1,
  },
  {
    name: "readonly scalar ref alias",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const holder = useRef(loadValue); const run = holder;",
    effect: "run.current();",
    expected: 1,
  },
  {
    name: "uncalled callback",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "",
    expected: 0,
  },
  {
    name: "event callback only",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "subscribe(() => run());",
    expected: 0,
  },
  {
    name: "cleanup callback only",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "",
    cleanup: "return () => run();",
    expected: 0,
  },
  {
    name: "unknown iterator callback",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "queue.map(() => run());",
    expected: 0,
  },
  {
    name: "unknown Promise receiver callback",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "queue.then(() => run());",
    expected: 0,
  },
  {
    name: "after return invocation",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "return; run();",
    expected: 0,
  },
  {
    name: "false invocation guard",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "if (false) run();",
    expected: 0,
  },
  {
    name: "zero bigint invocation guard",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "if (0n) run();",
    expected: 0,
  },
  {
    name: "negated true guard",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "if (!true) run();",
    expected: 0,
  },
  {
    name: "readonly false alias",
    setup:
      "const disabled = false; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "if (disabled) run();",
    expected: 0,
  },
  {
    name: "static comparison unsupported",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "if (1 > 2) run();",
    expected: 0,
  },
  {
    name: "dead await",
    setup:
      "const run = useCallback(async () => { if (false) await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "dead setter",
    setup:
      "const run = useCallback(async () => { await load(id); if (false) setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "exclusive await and setter",
    setup:
      "const run = useCallback(async () => { if (enabled) await load(id); else setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "conditional await then setter",
    setup:
      "const run = useCallback(async () => { if (enabled) await load(id); setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "callback binding replacement",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); run = other;",
    expected: 0,
  },
  {
    name: "callback binding destructuring",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); ({run} = source);",
    expected: 0,
  },
  {
    name: "callback default binding replacement",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); [run = other] = [];",
    expected: 0,
  },
  {
    name: "callback member pattern metadata",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); ({description: run.description} = source);",
    expected: 1,
  },
  {
    name: "callback computed key read",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); ({[run]: target} = source);",
    expected: 1,
  },
  {
    name: "callback default right read",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); [target = run] = [];",
    expected: 1,
  },
  {
    name: "ref binding replacement",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); run = other;",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "ref current replaced by other function",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); run.current = other;",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "ref current destructuring replacement",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); ({current:run.current} = source);",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "ref object escaped",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); mutate(run);",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "ref descriptor replacement",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const run = useRef(loadValue); Object.defineProperty(run, 'current', descriptor);",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "ref alias replaced",
    setup:
      "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]); const holder = useRef(loadValue); const run = holder; run = other;",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "callback parameter unsupported",
    setup:
      "const run = useCallback(async (enabled) => { if (enabled) { await load(id); setValue(id); } }, [id]);",
    effect: "run(false);",
    expected: 0,
  },
  {
    name: "callback this unsupported",
    setup:
      "const run = useCallback(async function () { if (this.enabled) { await load(id); setValue(id); } }, [id]);",
    expected: 0,
  },
  {
    name: "callback arguments unsupported",
    setup:
      "const run = useCallback(async function () { if (arguments[0]) { await load(id); setValue(id); } }, [id]);",
    expected: 0,
  },
  {
    name: "generator unsupported",
    setup: "const run = useCallback(function* () { setValue(id); yield load(id); }, [id]);",
    expected: 0,
  },
  {
    name: "ref callback initialization TDZ",
    setup:
      "const run = useRef(loadValue); const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "run.current();",
    expected: 0,
  },
  {
    name: "later callback alias TDZ",
    setup: "const loadValue = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    effect: "run(); const run = loadValue;",
    expected: 0,
  },
  {
    name: "latest ref cancellation",
    setup:
      "const cancelled = useRef(false); const run = useCallback(async () => { await load(id); if (!cancelled.current) setValue(id); }, [id]);",
    cleanup: "return () => { cancelled.current = true; };",
    expected: 0,
  },
  {
    name: "guard invalidated by memoized callback",
    setup:
      "const cancelled = useRef(false); const reset = useCallback(() => { cancelled.current = false; }, []); const run = useCallback(async () => { await load(id); reset(); if (!cancelled.current) setValue(id); }, [id]);",
    cleanup: "return () => { cancelled.current = true; };",
    expected: 1,
  },
  {
    name: "setter binding replaced",
    setup:
      "const run = useCallback(async () => { await load(id); setValue(id); }, [id]); setValue = other;",
    expected: 0,
  },
  {
    name: "setter metadata preserved",
    setup:
      "setValue.description = 'update'; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 1,
  },
];

interface ProviderCase {
  readonly name: string;
  readonly imports: string;
  readonly setup?: string;
  readonly beforeState?: string;
  readonly expected: number;
}

const providers: ProviderCase[] = [
  {
    name: "renamed React API imports",
    imports: "import {useState, useEffect, useCallback as memoizeCallback} from 'react';",
    setup: "const run = memoizeCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "genuine default React namespace",
    imports: "import React from 'react';",
    beforeState: "const useState=React.useState;",
    setup: "const run = React.useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "shadowed callback API",
    imports: "import {useState, useEffect} from 'react';",
    setup:
      "const useCallback = () => () => {}; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "named callback API replacement",
    imports: "import {useState, useEffect, useCallback} from 'react';",
    setup:
      "useCallback = other; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "callback API escape",
    imports: "import {useState, useEffect, useCallback} from 'react';",
    setup:
      "mutate(useCallback); const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "callback API metadata",
    imports: "import {useState, useEffect, useCallback} from 'react';",
    setup:
      "useCallback.description='memoize'; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 1,
  },
  {
    name: "state API replacement",
    imports: "import {useState, useEffect, useCallback} from 'react';",
    beforeState: "useState = other;",
    setup: "const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
  {
    name: "effect API replacement",
    imports: "import {useState, useEffect, useCallback} from 'react';",
    setup:
      "useEffect = other; const run = useCallback(async () => { await load(id); setValue(id); }, [id]);",
    expected: 0,
  },
];

describe("callback indirection API provenance", () => {
  it.each(providers)("$name", ({ imports, setup = "", beforeState = "", expected }) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `${imports}
      const Panel = ({id, load}) => {
        ${beforeState}
        const [value, setValue] = useState(null);
        ${setup}
        useEffect(() => { run(); }, [id]);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it.each([
    { guard: "", expected: 1 },
    { guard: "React.useCallback = other;", expected: 0 },
    { guard: "React.useState = other;", expected: 0 },
    { guard: "React.useRef = other;", expected: 0 },
    { guard: "React.useEffect = other;", expected: 0 },
    { guard: "Object.assign(React, {useCallback: other});", expected: 0 },
    { guard: "mutate(React);", expected: 0 },
    { guard: "React.description = 'provider';", expected: 1 },
    { guard: "({description: React.description} = source);", expected: 1 },
  ])("namespace provider guard $guard", ({ guard, expected }) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      import React from 'react';
      ${guard}
      const Panel = ({id, load}) => {
        const [value, setValue] = React.useState(null);
        const run = React.useCallback(async () => { await load(id); setValue(id); }, [id]);
        const holder = React.useRef(run);
        React.useEffect(() => { holder.current(); }, [id]);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("retains callback body proof through a returned hook object", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      import {useState, useEffect, useCallback, useRef} from 'react';
      export const useLoader = ({id, load}) => {
        const [value, setValue] = useState(null);
        const run = useCallback(async () => { await load(id); setValue(id); }, [id]);
        const holder = useRef(run);
        useEffect(() => { holder.current = run; }, [run]);
        useEffect(() => { holder.current(); }, [id]);
        return {value, run};
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-set-state-after-await-in-effect callback indirection", () => {
  it.each(cases)("$name", ({ setup, effect = "run();", cleanup = "", expected }) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `
      import {useState, useReducer, useCallback, useEffect, useRef} from "react";
      const Panel = ({id, enabled, load}) => {
        const [value, setValue] = useState(null);
        ${setup}
        useEffect(() => { ${effect} ${cleanup} }, [id]);
        return null;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
