import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleDiagnostic, RunRuleOptions } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { callHasImportedReturnedNativeScheduler } from "../../utils/call-has-imported-returned-native-scheduler.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import * as scopeAnalysis from "../../semantic/scope-analysis.js";
import {
  __clearParseSourceFileCacheForTests,
  parseSourceFile,
} from "../../utils/parse-source-file.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../utils/rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

interface SchedulerFixture {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly options: RunRuleOptions;
  readonly expectedCertificateDiagnostics: ReadonlyArray<RuleDiagnostic>;
  readonly expectedRuleDiagnostics: ReadonlyArray<RuleDiagnostic> | null;
}

const MESSAGE =
  "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.";
const CONSUMER_SOURCE =
  "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{queue();return previous+1;})}>{value}</button>;};";
const SCHEDULER_SOURCE =
  "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}";
const PURE_SOURCE =
  "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{return 1;},[callback]);return queue;}";
let temporaryDirectory: string;

const resetResolvers = (): void => {
  __clearParseSourceFileCacheForTests();
  resetFilesystemCaches();
};

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "returned-native-scheduler-"));
  resetResolvers();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, code: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, code);
  return filename;
};

const certificateRule: Rule = {
  ...noSideEffectInStateUpdaterFunction,
  create: (context) => ({
    CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
      if (callHasImportedReturnedNativeScheduler(node, context))
        context.report({ node, message: MESSAGE });
    },
  }),
};

const fixtures: ReadonlyArray<SchedulerFixture> = [
  {
    name: "direct-returned-native-react-callback-schedules",
    files: { "/src/example.tsx": CONSUMER_SOURCE, "/src/queue.ts": SCHEDULER_SOURCE },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "renamed-import-and-result",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue as useWork} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const pending=useWork(()=>{});return <button onClick={()=>setValue(previous=>{pending();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts": SCHEDULER_SOURCE,
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 139,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 139,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "pure-returned-callback",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{return 1;},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: [],
  },
  {
    name: "timer-only-in-uninvoked-nested-function",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{const later=()=>window.setTimeout(()=>callback(),0); return later;},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: [],
  },
  {
    name: "async-returned-function",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(async()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "known-false-scheduler-branch",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);if(false)timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "foreign-shadowed-window",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nconst window={clearTimeout(){},setTimeout(){return 0;}};\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: [],
  },
  {
    name: "fake-react-wrapper",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "const React={useRef:()=>({current:0}),useCallback:()=>()=>{}};\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: [],
  },
  {
    name: "conditional-return-can-select-pure-callback",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return callback ? ()=>{} : queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "export-binding-reassigned",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nuseQueue=()=>()=>{};",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "transparent-direct-eval-binding-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\n(eval as any)('useQueue = () => () => {}');",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "provider-method-replaced",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nwindow.setTimeout=()=>0;",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "native-timer-captured-via-alias",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nconst schedule=window.setTimeout;\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=schedule(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "use-callback-provider-visibly-replaced",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nReact.useCallback=()=>()=>{};",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "returned-callback-created-but-not-called-in-updater",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{const deferred=()=>queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts": SCHEDULER_SOURCE,
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 157,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [],
  },
  {
    name: "imported-factory-call-only-within-deferred-updater-function",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{return ()=>queue();})}>{value}</button>;};",
      "/src/queue.ts": SCHEDULER_SOURCE,
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 149,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [],
  },
  {
    name: "catch-computed-factory-binding-overwrite",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\ntry{throw {}}catch({[useQueue=()=>()=>{}]:ignored}){}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "catch-computed-caller-result-overwrite",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});try{throw {}}catch({[queue=()=>{}]:ignored}){} return <button onClick={()=>setValue(previous=>{queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts": SCHEDULER_SOURCE,
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "catch-computed-native-timer-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\ntry{throw {}}catch({[window.setTimeout=()=>0]:ignored}){}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "catch-computed-react-callback-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\ntry{throw {}}catch({[React.useCallback=()=>()=>{}]:ignored}){}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "erased-declared-window-provider",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\ndeclare const window:any;\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "erased-declared-react-provider",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "declare const React:any;\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "runtime-ts-parameter-property-provider-capability",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nclass Patch{constructor(public window:any=(globalThis.window={clearTimeout(){},setTimeout(){return 0;}})) {}} new Patch();",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "returned-callback-early-return-before-timer",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{return;window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "returned-callback-throw-before-timer",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{throw new Error('stop');window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "generator-factory",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function* useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "factory-alternate-early-return",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){if(callback)return ()=>{};const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "factory-throw-before-return",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);throw new Error('stop');return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "type-only-react-namespace-import",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import type * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "factory-self-scoped-binding-write",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){useQueue=()=>()=>{};const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "window-namespace-alias-replaces-timer",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nconst clocks=window;clocks.setTimeout=()=>0;",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "react-namespace-alias-replaces-callback-wrapper",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nconst runtime=React;runtime.useCallback=()=>()=>{};",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "reflective-native-provider-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nObject.defineProperty(window,'setTimeout',{value:()=>0});",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "reflective-ref-getter-throws-before-scheduler",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);Object.defineProperty(timer,'current',{get(){throw new Error('stop')}});const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "called-local-thrower-before-scheduler",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{(()=>{throw new Error('stop')})();window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "factory-return-before-callback-declaration-tdz",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);return queue;const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "member-eval-replaces-factory-binding",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\n(window.eval as any)('useQueue = () => () => {}');",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "unknown-computed-native-provider-write",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nconst method='setTimeout';window[method]=()=>0;",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "computed-catch-shorthand-factory-overwrite",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\ntry{throw {}}catch({[({useQueue}={useQueue:()=>()=>{}})]:ignored}){}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "object-pattern-function-constructor-provider-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nconst {constructor:makeCode}=(()=>{});makeCode(\"window.setTimeout=()=>0\")();",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "legacy-window-getter-provider-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nwindow.__defineGetter__('setTimeout',()=>()=>0);",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "reflective-function-constructor-provider-replacement",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}\nReflect.get(()=>{},'constructor')(\"window.setTimeout=()=>0\")();",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "module-scoped-returned-callback",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nconst timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);\nexport function useQueue(callback){return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "module-scoped-ref-handle",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nconst timer=React.useRef(0);export function useQueue(callback){const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "callback-wrapper-missing-dependencies",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);});return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "callback-wrapper-extra-argument",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback],1);return queue;}",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [],
    expectedRuleDiagnostics: null,
  },
  {
    name: "returned-callback-with-native-handle-cleanup-and-deferred-capture",
    files: {
      "/src/example.tsx": CONSUMER_SOURCE,
      "/src/queue.ts":
        "import * as React from 'react';\nimport {useHandler} from './handler';\nexport function useQueue(callback,delay){const dispatch=useHandler(callback);const timer=React.useRef(0);React.useEffect(()=>()=>window.clearTimeout(timer.current),[]);const queued=React.useCallback((...values)=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>dispatch(...values),delay);},[dispatch,delay]);return queued;}",
      "/src/handler.ts": "export const useHandler=(callback)=>callback;",
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "retains-direct-native-scheduler-before-returned-callback",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{window.setTimeout(()=>{},0);queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts": SCHEDULER_SOURCE,
    },
    options: { filename: "/src/example.tsx", includeLocations: true },
    expectedCertificateDiagnostics: [
      {
        column: 166,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
      {
        column: 166,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-window-interface",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts":
        "interface window {}\nimport * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: {
      filename: "/src/example.tsx",
      includeLocations: true,
    },
    expectedCertificateDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "erased-react-interface",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts":
        "interface React {}\nimport * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: {
      filename: "/src/example.tsx",
      includeLocations: true,
    },
    expectedCertificateDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "nested-erased-capability",
    files: {
      "/src/example.tsx":
        "import {useState} from 'react';\nimport {useQueue} from './queue';\nexport const Example=()=>{const [value,setValue]=useState(0);const queue=useQueue(()=>{});return <button onClick={()=>setValue(previous=>{queue();return previous+1;})}>{value}</button>;};",
      "/src/queue.ts":
        "type Note = ({nested: {constructor}}: {nested:{constructor:string}}) => void;\nimport * as React from 'react';\nexport function useQueue(callback){const timer=React.useRef(0);const queue=React.useCallback(()=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>callback(),0);},[callback]);return queue;}",
    },
    options: {
      filename: "/src/example.tsx",
      includeLocations: true,
    },
    expectedCertificateDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
    expectedRuleDiagnostics: [
      {
        column: 138,
        line: 3,
        message:
          "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.",
        nodeType: "CallExpression",
      },
    ],
  },
];

describe("returned native scheduler in a state updater", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      for (const [filename, code] of Object.entries(fixture.files))
        writeFile(filename.slice(1), code);
      const source = fixture.files["/src/example.tsx"];
      const options = {
        ...fixture.options,
        filename: path.join(temporaryDirectory, "src/example.tsx"),
      };
      expect(runRule(certificateRule, source, options)).toEqual({
        diagnostics: fixture.expectedCertificateDiagnostics,
        parseErrors: [],
      });
      if (fixture.expectedRuleDiagnostics !== null) {
        expect(runRule(noSideEffectInStateUpdaterFunction, source, options)).toEqual({
          diagnostics: fixture.expectedRuleDiagnostics,
          parseErrors: [],
        });
      }
    });
  }

  it("declines uncertain foreign analysis while retaining direct native findings", () => {
    const provider = writeFile("src/queue.ts", SCHEDULER_SOURCE);
    const source = CONSUMER_SOURCE.replace("queue();", "window.setTimeout(()=>{},0);queue();");
    const filename = writeFile("src/example.tsx", source);
    const foreignProgram = parseSourceFile(provider);
    expect(foreignProgram).not.toBeNull();
    const analyzeScopes = scopeAnalysis.analyzeScopes;
    const analysis = vi.spyOn(scopeAnalysis, "analyzeScopes").mockImplementation((program) => {
      if (program === foreignProgram) throw new Error("Foreign scope analysis unavailable");
      return analyzeScopes(program);
    });
    try {
      expect(runRule(noSideEffectInStateUpdaterFunction, source, { filename })).toEqual({
        diagnostics: [{ message: MESSAGE, nodeType: "CallExpression" }],
        parseErrors: [],
      });
      expect(analysis).toHaveBeenCalledWith(foreignProgram);
    } finally {
      analysis.mockRestore();
    }
  });

  it("records all rule resolver reads in the existing dependency collector", () => {
    writeFile("src/queue.ts", SCHEDULER_SOURCE);
    const filename = writeFile("src/example.tsx", CONSUMER_SOURCE);
    const observed = captureCrossFileProbes(() =>
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }),
    );
    const collected = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: CONSUMER_SOURCE,
      ruleIds: [noSideEffectInStateUpdaterFunction.id],
    });
    expect(observed.value.diagnostics).toEqual([{ message: MESSAGE, nodeType: "CallExpression" }]);
    expect(collected?.contentPaths.has(path.join(temporaryDirectory, "src/queue.ts"))).toBe(true);
    for (const filename of observed.trace.contentPaths)
      expect(collected?.contentPaths.has(filename)).toBe(true);
    for (const filename of observed.trace.existencePaths)
      expect(collected?.existencePaths.has(filename)).toBe(true);
  });

  it("reads changed provider contents before retaining a cached certificate", () => {
    const provider = writeFile("src/queue.ts", SCHEDULER_SOURCE);
    const filename = writeFile("src/example.tsx", CONSUMER_SOURCE);
    expect(
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }).diagnostics,
    ).toEqual([{ message: MESSAGE, nodeType: "CallExpression" }]);
    fs.writeFileSync(provider, PURE_SOURCE);
    resetResolvers();
    expect(
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }).diagnostics,
    ).toEqual([]);
  });

  it("records missing provider candidates and notices appearance and deletion", () => {
    const filename = writeFile("src/example.tsx", CONSUMER_SOURCE);
    const provider = path.join(temporaryDirectory, "src/queue.ts");
    const missing = captureCrossFileProbes(() =>
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }),
    );
    expect(missing.value.diagnostics).toEqual([]);
    expect(missing.trace.existencePaths.has(provider)).toBe(true);
    writeFile("src/queue.ts", SCHEDULER_SOURCE);
    resetResolvers();
    expect(
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }).diagnostics,
    ).toEqual([{ message: MESSAGE, nodeType: "CallExpression" }]);
    fs.unlinkSync(provider);
    resetResolvers();
    expect(
      runRule(noSideEffectInStateUpdaterFunction, CONSUMER_SOURCE, { filename }).diagnostics,
    ).toEqual([]);
  });

  it("tracks a tsconfig alias retargeting to a pure provider", () => {
    writeFile("src/queue.ts", SCHEDULER_SOURCE);
    writeFile("src/pure.ts", PURE_SOURCE);
    const source = CONSUMER_SOURCE.replace("./queue", "@queue");
    const filename = writeFile("src/example.tsx", source);
    const configuration = writeFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@queue": ["./src/queue"] } } }),
    );
    const initial = captureCrossFileProbes(() =>
      runRule(noSideEffectInStateUpdaterFunction, source, { filename }),
    );
    expect(initial.value.diagnostics).toEqual([{ message: MESSAGE, nodeType: "CallExpression" }]);
    expect(initial.trace.contentPaths.has(configuration)).toBe(true);
    fs.writeFileSync(
      configuration,
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@queue": ["./src/pure"] } } }),
    );
    resetResolvers();
    expect(runRule(noSideEffectInStateUpdaterFunction, source, { filename }).diagnostics).toEqual(
      [],
    );
  });

  it("declines a barrel export without changing the import spelling", () => {
    writeFile("src/native.ts", SCHEDULER_SOURCE);
    writeFile("src/queue.ts", "export { useQueue } from './native';");
    const filename = writeFile("src/example.tsx", CONSUMER_SOURCE);
    expect(runRule(certificateRule, CONSUMER_SOURCE, { filename }).diagnostics).toEqual([]);
  });
});
