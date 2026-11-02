import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnownedAsyncErrorClear } from "./no-unowned-async-error-clear.js";

interface OwnerSnapshotCase {
  name: string;
  code: string;
  options: Parameters<typeof runRule>[2];
  expectedCount: number;
}

const cases: ReadonlyArray<OwnerSnapshotCase> = [
  {
    name: "owner-const-alias-post-await-exit",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/owner-const-alias-post-await-exit.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "arbitrary-snapshot-name",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const snapshot = requestId;\n    const result = await task();\n    if (requestRef.current !== snapshot) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/arbitrary-snapshot-name.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "readonly-const-alias-chain",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const selected = requestId;\n    const mine = selected;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/readonly-const-alias-chain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "strict-equality-owned-branch",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current === mine && result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/strict-equality-owned-branch.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "throwing-mismatch-exit",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) throw new Error("stale");\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/throwing-mismatch-exit.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "pre-await-only-owner-check",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    if (requestRef.current !== mine) return false;\n    const result = await task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/pre-await-only-owner-check.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "suspension-after-owner-check",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    await task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/suspension-after-owner-check.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "wrong-ref-owner-comparison",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const otherRef = useRef(requestId);\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (otherRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/wrong-ref-owner-comparison.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "different-readonly-owner-input",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>, unrelatedId: string) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = unrelatedId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/different-readonly-owner-input.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "rebound-snapshot",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    let mine = requestId;\n    const result = await task();\n    mine = requestRef.current;\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/rebound-snapshot.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "snapshot-current-owner-after-await",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const result = await task();\n    const mine = requestRef.current;\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/snapshot-current-owner-after-await.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "nonexiting-mismatch-branch",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) console.log("stale");\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/nonexiting-mismatch-branch.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "unguarded-or-alternative",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>, force: boolean) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if ((requestRef.current === mine || force) && result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/unguarded-or-alternative.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "getter-backed-owner-source",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const source = { get id() { return requestRef.current; } };\n    const mine = source.id;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/getter-backed-owner-source.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "source-visible-owner-overwrite",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    requestRef.current = "different";\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/source-visible-owner-overwrite.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "owner-ref-escape",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const inspect = (value: unknown) => console.log(value);\n  inspect(requestRef);\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/owner-ref-escape.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "fake-hook-provider",
    code: 'import { useState } from "react";\nconst useRef = (value: string) => ({ current: value });\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/fake-hook-provider.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "visible-reentrant-status-getter",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    const status = { get ok() { requestRef.current = "different"; return result.ok; } };\n    if (status.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/visible-reentrant-status-getter.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "mismatch-break-before-unreachable-return",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) { do { break; return false; } while (false); }\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/mismatch-break-before-unreachable-return.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "mismatch-throw-caught-before-clear",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    try { if (requestRef.current !== mine) throw new Error("stale"); } catch {}\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/mismatch-throw-caught-before-clear.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "ownership-comparison-before-awaited-condition-result",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (await Promise.resolve(requestRef.current !== mine)) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/ownership-comparison-before-awaited-condition-result.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "invoked-visible-owner-mutator-between-proof-and-clear",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const rotateOwner = () => { requestRef.current = "different"; };\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    rotateOwner();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/invoked-visible-owner-mutator-between-proof-and-clear.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "nested-erased-owner-reference-mutator",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const rotateOwner = () => { interface requestRef {} requestRef.current = "different"; };\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    rotateOwner();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/nested-erased-owner-reference-mutator.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "memoized-async-callback-readonly-owner-snapshot",
    code: 'import { useCallback, useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = useCallback(async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  }, [requestId, task]);\n  return { error, send };\n};\n',
    options: {
      filename: "src/memoized-async-callback-readonly-owner-snapshot.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "owner-ref-missing-render-refresh",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/owner-ref-missing-render-refresh.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "selected-setter-opaque-transport",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const selectedSetter = setError;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/selected-setter-opaque-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "selected-ref-member-alias-write",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const ownerAlias = requestRef;\n  const rotate = () => { ownerAlias.current = "next"; };\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/selected-ref-member-alias-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "secondary-react-namespace-replacement",
    code: 'import { useRef, useState } from "react";\nimport * as ReactRuntime from "react";\nReactRuntime.useRef = () => ({current: "next"});\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/secondary-react-namespace-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-owner-ref-provider",
    code: 'import { useState } from "react";\nimport type { useRef } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/type-only-owner-ref-provider.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "ambient-program-boundary",
    code: 'declare const externalToolkit: unknown;\nimport { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/ambient-program-boundary.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "callback-call-between-guard-and-clear",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    task();\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/callback-call-between-guard-and-clear.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-owner-parameter-reassigned",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    requestId = "next";\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/readonly-owner-parameter-reassigned.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "owner-default-parameter-outside-profile",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string = "initial", task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/owner-default-parameter-outside-profile.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "clear-argument-await-after-guard",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(await Promise.resolve(null)); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/clear-argument-await-after-guard.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "reversed-strict-owner-comparison",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (mine !== requestRef.current) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/reversed-strict-owner-comparison.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "actual-react-namespace-owner-hooks",
    code: 'import * as ReactRuntime from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = ReactRuntime.useState<unknown | null>(null);\n  const requestRef = ReactRuntime.useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/actual-react-namespace-owner-hooks.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "unrelated-type-only-reexport-keeps-owner-proof",
    code: 'import { useRef, useState } from "react";\nimport type { DeliveryMetadata } from "./metadata-provider";\nexport type { DeliveryMetadata };\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/unrelated-type-only-reexport-keeps-owner-proof.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "foreign-owner-ref-captured-by-child-state",
    code: 'import { useRef, useState } from "react";\nexport const ParentDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n    const [error, setError] = useState<unknown | null>(null);\n    const send = async () => {\n      const mine = requestId;\n      const result = await task();\n      if (requestRef.current !== mine) return false;\n      if (result.ok) { setError(null); return true; }\n      setError({ reason: "not-ready" });\n      return false;\n    };\n    return { error, send };\n  };\n  return useDelivery(requestId, task);\n};\n',
    options: {
      filename: "src/foreign-owner-ref-captured-by-child-state.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "source-visible-reflective-status-getter",
    code: 'import { useRef, useState } from "react";\nexport const useDelivery = (requestId: string, task: () => Promise<{ ok: boolean }>) => {\n  const [error, setError] = useState<unknown | null>(null);\n  const requestRef = useRef(requestId);\n  requestRef.current = requestId;\n  const send = async () => {\n    const mine = requestId;\n    const result = await task();\n    Object.defineProperty(result, "ok", { get: () => { task(); return true; } });\n    if (requestRef.current !== mine) return false;\n    if (result.ok) { setError(null); return true; }\n    setError({ reason: "not-ready" });\n    return false;\n  };\n  return { error, send };\n};\n',
    options: {
      filename: "src/source-visible-reflective-status-getter.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
];

describe("readonly owner snapshot completion", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noUnownedAsyncErrorClear, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
