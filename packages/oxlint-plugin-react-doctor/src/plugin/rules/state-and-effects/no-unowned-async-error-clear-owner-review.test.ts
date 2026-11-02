import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

interface OwnerSnapshotReviewCase {
  name: string;
  code: string;
  expected: number;
}

const cases: readonly OwnerSnapshotReviewCase[] = [
  {
    name: "baseline-readonly-owner-guard",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "unguarded-clear-activation",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "merged-owner-ref-interface",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  interface requestRef {}\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "merged-owner-input-interface",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  interface requestId {}\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "merged-snapshot-interface",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    interface mine {}\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "merged-ref-hook-interface",
    code: 'import { useRef, useState } from "react";\ninterface useRef {}\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "merged-state-hook-unsafe-interface",
    code: 'import { useRef, useState } from "react";\ninterface useState {}\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "merged-setter-unsafe-interface",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  interface setError {}\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "global-require-provider-write",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nrequire("react").useRef = replacement;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "global-module-require-provider-write",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nmodule.require("react").useRef = replacement;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "global-module-require-default-provider-write",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nmodule.require("react").default.useRef = replacement;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "readonly-global-module-provider",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nconst loadedRef = module.require("react").useRef;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "foreign-global-module-write",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nmodule.require("other-runtime").useRef = replacement;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-module-write",
    code: 'import { useRef, useState } from "react";\nconst replacement = (value: string) => ({ current: value });\nconst module = { require: (_source: string) => ({ useRef: replacement }) }; module.require("react").useRef = replacement;\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "selected-loaded-react-namespace-escape",
    code: 'import { inspect } from "./provider-observer";\nimport { useRef, useState } from "react";\ninspect(module.require("react"));\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
  {
    name: "foreign-loaded-namespace-escape",
    code: 'import { inspect } from "./provider-observer";\nimport { useRef, useState } from "react";\ninspect(module.require("other-runtime"));\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-loaded-namespace-escape",
    code: 'import { inspect } from "./provider-observer";\nimport { useRef, useState } from "react";\nconst module = { require: (_source: string) => ({ useRef: () => null }) }; inspect(module.require("react"));\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 0,
  },
  {
    name: "matching-name-first",
    code: "import{useRef,useState}from'react';\ninterface mineA {}\nexport const useDeliveryA=(requestId:string,task:()=>Promise<void>)=>{const[error,setErrorA]=useState(null);const latestA=useRef(requestId);latestA.current=requestId;const send=async()=>{const mineA=requestId;await task();if(latestA.current===mineA)setErrorA(null);setErrorA({reason:'not-ready'});};return{error,send}};\nexport const useDeliveryB=(requestId:string,task:()=>Promise<void>)=>{const[error,setErrorB]=useState(null);const latestB=useRef(requestId);latestB.current=requestId;const send=async()=>{const mineB=requestId;await task();if(latestB.current===mineB)setErrorB(null);setErrorB({reason:'not-ready'});};return{error,send}};",
    expected: 0,
  },
  {
    name: "matching-name-last",
    code: "import{useRef,useState}from'react';\ninterface mineA {}\nexport const useDeliveryB=(requestId:string,task:()=>Promise<void>)=>{const[error,setErrorB]=useState(null);const latestB=useRef(requestId);latestB.current=requestId;const send=async()=>{const mineB=requestId;await task();if(latestB.current===mineB)setErrorB(null);setErrorB({reason:'not-ready'});};return{error,send}};\nexport const useDeliveryA=(requestId:string,task:()=>Promise<void>)=>{const[error,setErrorA]=useState(null);const latestA=useRef(requestId);latestA.current=requestId;const send=async()=>{const mineA=requestId;await task();if(latestA.current===mineA)setErrorA(null);setErrorA({reason:'not-ready'});};return{error,send}};",
    expected: 0,
  },
  {
    name: "destructured-parameter-write",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    ({ requestId } = { requestId: "next" });\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    expected: 1,
  },
];

describe("readonly owner snapshot review", () => {
  for (const reviewCase of cases) {
    it(reviewCase.name, () => {
      const result = runRule(noUnownedAsyncErrorClear, reviewCase.code, {
        filename: `src/${reviewCase.name}.tsx`,
        forceJsx: false,
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(reviewCase.expected);
    });
  }
});
