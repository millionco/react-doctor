import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface NativeIntervalReviewCase {
  name: string;
  code: string;
  expected: number;
}

const cases: ReadonlyArray<NativeIntervalReviewCase> = [
  {
    name: "nominal-native-interval",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "cancelled-after-await",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; setValue(first); }, 5000);\n    return () => { cancelled = true; clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "guard-before-second-await",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; const second = await load(first); setValue(second); }, 5000);\n    return () => { cancelled = true; clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "mount-only-outside-current-rule",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, []);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "stable-dependency-outside-current-rule",
    code: 'import { useEffect, useState, useReducer } from "react";\nconst stable = 1;\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [stable]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "default-react-nominal",
    code: 'import React from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = React.useState("");\n  React.useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "default-react-getter-mutation",
    code: 'import React from "react";\nReact.__defineGetter__("useEffect", () => (() => {}));\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = React.useState("");\n  React.useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "default-react-setter-mutation",
    code: 'import React from "react";\nReact.__defineSetter__("useState", () => {});\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = React.useState("");\n  React.useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "default-react-readonly-module-call",
    code: 'import React from "react";\nReact.memo(() => null);\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = React.useState("");\n  React.useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "native-reducer-dispatch",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useReducer((current, next) => next, "");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "block-return-native-clear-cleanup",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => { return clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "literal-void-effect-prologue",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    void 0;\n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "combined-void-and-block-cleanup",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    void 0;\n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => { return clearInterval(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 1,
  },
  {
    name: "opaque-void-call-prologue-declines",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    void observe();\n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "non-native-cleanup-return-declines",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    \n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => { return observe(interval); };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "tdz-undefined-expression-is-not-inert",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    undefined;\n    let undefined = false;\n    const interval = setInterval(async () => { const first = await load(revision); setValue(first); }, 5000);\n    return () => clearInterval(interval);\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
  {
    name: "exact-full-fuzz-reproducer-1",
    code: '// rule: no-set-state-after-await-in-effect\n// kind: verdict-drop\n// seed: 42000347 (iteration 221)\n// variant: concise arrow bodies converted to block returns\n// detail: diagnostics disappeared under verdict-preserving rewrite "concise arrow bodies converted to block returns" (base had 1)\nimport * as ReactQuery from "@tanstack/react-query";\nimport { useQuery, useMutation } from "@tanstack/react-query";\nimport dynamic from "next/dynamic";\nimport { create as createZustandStore } from "zustand"; const useFuzzZustandStore = createZustandStore(() => { return (({ value: 0 })); });\nimport { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => { return (<button>{props.label}</button>); });\n\nimport { useState as useTimerState, useEffect as useTimerEffect } from "react"; export const useFuzzTimer = (revision, load) => { const [value, setValue] = useTimerState(""); useTimerEffect(() => { const timer = setInterval(async () => { const next = await load(revision); setValue(next); }, 1000); return () => { return (clearInterval(timer)); }; }, [revision, load]); return value; };\n\nconst useFuzzToggle76 = (initial) => {\n  const stored = useRef(initial);\n  useEffect(() => { stored.current = initial; });\n  return useCallback(() => { return (stored.current); }, []);\n};\n\nconst FuzzOverlay4 = () => {\n  const [counterState, dispatchCounter] = useReducer((state, action) => { state.count += 1; return state; }, { count: 0 });\n  useEffect(() => { let isActive = true; let timeoutId; fetch(url).then(() => { if (!isActive) return; timeoutId = setTimeout(handle, 100); }); return () => { isActive = false; if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); } }; }, [url, shouldSkipRelease]);\n  const handleSubmit = async () => { setLoading(true); const result = await api.post(url, values); setState(result); setLoading(false); };\n  const handlePersistToken = () => { localStorage.setItem("auth_token", String(value)); };\n  const savingRef = useRef(false);\n  const handleGuardedSave = async () => {\n    if (savingRef.current) return;\n    savingRef.current = true;\n    await api.post(url, values);\n    setState(true);\n    savingRef.current = false;\n  };\n  return (<li>{createPortal(<div>{state}</div>, document.body)}</li>);\n};\n',
    expected: 1,
  },
  {
    name: "exact-full-fuzz-reproducer-2",
    code: '// rule: no-set-state-after-await-in-effect\n// kind: verdict-drop\n// seed: 42000347 (iteration 221)\n// variant: no-op prologue statement in every function body\n// detail: diagnostics disappeared under verdict-preserving rewrite "no-op prologue statement in every function body" (base had 1)\nimport * as ReactQuery from "@tanstack/react-query";\nimport { useQuery, useMutation } from "@tanstack/react-query";\nimport dynamic from "next/dynamic";\nimport { create as createZustandStore } from "zustand"; const useFuzzZustandStore = createZustandStore(() => ({ value: 0 }));\nimport { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => <button>{props.label}</button>);\n\nimport { useState as useTimerState, useEffect as useTimerEffect } from "react"; export const useFuzzTimer = (revision, load) => { void 0; const [value, setValue] = useTimerState(""); useTimerEffect(() => { void 0; const timer = setInterval(async () => { void 0; const next = await load(revision); setValue(next); }, 1000); return () => clearInterval(timer); }, [revision, load]); return value; };\n\nconst useFuzzToggle76 = (initial) => { void 0;\n  const stored = useRef(initial);\n  useEffect(() => { void 0; stored.current = initial; });\n  return useCallback(() => stored.current, []);\n};\n\nconst FuzzOverlay4 = () => { void 0;\n  const [counterState, dispatchCounter] = useReducer((state, action) => { void 0; state.count += 1; return state; }, { count: 0 });\n  useEffect(() => { void 0; let isActive = true; let timeoutId; fetch(url).then(() => { void 0; if (!isActive) return; timeoutId = setTimeout(handle, 100); }); return () => { void 0; isActive = false; if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); } }; }, [url, shouldSkipRelease]);\n  const handleSubmit = async () => { void 0; setLoading(true); const result = await api.post(url, values); setState(result); setLoading(false); };\n  const handlePersistToken = () => { void 0; localStorage.setItem("auth_token", String(value)); };\n  const savingRef = useRef(false);\n  const handleGuardedSave = async () => { void 0;\n    if (savingRef.current) return;\n    savingRef.current = true;\n    await api.post(url, values);\n    setState(true);\n    savingRef.current = false;\n  };\n  return (<li>{createPortal(<div>{state}</div>, document.body)}</li>);\n};\n',
    expected: 1,
  },
  {
    name: "terminal-native-clear-retains-cancellation",
    code: 'import { useEffect, useState, useReducer } from "react";\n\nexport const Panel = ({revision, load}) => {\n  const [value, setValue] = useState("");\n  useEffect(() => {\n    void 0; let cancelled = false;\n    const interval = setInterval(async () => { const first = await load(revision); if (cancelled) return; setValue(first); }, 5000);\n    return () => { void 0; cancelled = true; return clearInterval(interval); void 0; };\n  }, [revision]);\n  return <output data-value={value} />;\n};\n',
    expected: 0,
  },
];

describe("native interval provider and cancellation boundaries", () => {
  for (const selectedCase of cases) {
    it(selectedCase.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, selectedCase.code, {
        filename: "/synthetic/native-interval-review/fixture.tsx",
        includeLocations: true,
        settings: {
          "react-doctor": {
            portedRuleMode: "curated",
            reactVersion: "18.3.1",
            reactMajorVersion: 18,
            framework: "unknown",
            capabilities: ["react"],
          },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(selectedCase.expected);
    });
  }
});
