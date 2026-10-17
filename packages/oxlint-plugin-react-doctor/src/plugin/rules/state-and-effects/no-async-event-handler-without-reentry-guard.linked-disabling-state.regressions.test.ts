import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

interface LinkedDisablingCase {
  name: string;
  code: string;
  expectedCount: number;
}

const linkedDisablingOptions: RunRuleOptions = {
  filename: "src/guard-example.tsx",
  settings: {
    "react-doctor": {
      capabilities: ["react", "react:19"],
    },
  },
};

const linkedDisablingCases: LinkedDisablingCase[] = [
  {
    name: "disabling-before-try-native-disabled",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling, setIsDisabling] = useState(false); const action = async () => { setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); } }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "disabling-inside-try-finally",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling, setIsDisabling] = useState(false); const action = async () => { try { setIsDisabling(true); await fetch("/api/work", {method:"POST"}); } finally { setIsDisabling(false); } }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "disabling-case-insensitive-vocabulary",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDISABLING, setIsDISABLING] = useState(false); const action = async () => { setIsDISABLING(true); await fetch("/api/work", {method:"POST"}); setIsDISABLING(false); }; return <button disabled={isDISABLING} onClick={action}>Run</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "leading-disabling-early-return",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling] = useState(false); const [,setDone] = useState(false); const action = async () => { if(isDisabling) return; await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "positive-member-disabling-reference",
    code: 'import { useState } from "react";\nexport const ActionButton = ({status}) => { const [,setDone] = useState(false); const action = async () => { if(status.isDisabling) return; await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "flag-written-only-after-await",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling,setIsDisabling] = useState(false); const action = async () => { await fetch("/api/work", {method:"POST"}); setIsDisabling(true); }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "false-before-await-not-guard",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling,setIsDisabling] = useState(false); const action = async () => { setIsDisabling(false); await fetch("/api/work", {method:"POST"}); setIsDisabling(false); }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "dynamic-before-await-not-guard",
    code: 'import { useState } from "react";\nexport const ActionButton = ({next}) => { const [isDisabling,setIsDisabling] = useState(false); const action = async () => { setIsDisabling(next); await fetch("/api/work", {method:"POST"}); setIsDisabling(false); }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "local-fake-setter-not-guard",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [,setDone] = useState(false); const setIsDisabling = (_value) => {}; const action = async () => { setIsDisabling(true); await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "inverted-disabling-guard-retained",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling] = useState(false); const [,setDone] = useState(false); const action = async () => { if(!isDisabling) return; await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "disabled-prop-alone-not-leading-guard",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isDisabling,setIsDisabling] = useState(false); const action = async () => { await fetch("/api/work", {method:"POST"}); setIsDisabling(false); }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "existing-loading-vocabulary-quiet",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [isLoading,setIsLoading] = useState(false); const action = async () => { setIsLoading(true); try { await fetch("/api/work", {method:"POST"}); } finally { setIsLoading(false); } }; return <button disabled={isLoading} onClick={action}>Run</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "ordinary-unguarded-positive",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [,setDone] = useState(false); const action = async () => { await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "no-post-await-setter-legacy-quiet",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const action = async () => { await fetch("/api/work", {method:"POST"}); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "unlinked-disabling-flag-inherited-precision-limit",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { const [,setIsDisabling] = useState(false); const [,setDone] = useState(false); const action = async () => { setIsDisabling(true); await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "foreign-hook-setter-not-guard",
    code: 'import { useState } from "react";\nimport { useState as useForeignState } from "other-state"; export const ActionButton = () => { const [,setIsDisabling] = useForeignState(false); const [,setDone] = useState(false); const action = async () => { setIsDisabling(true); await fetch("/api/work", {method:"POST"}); setDone(true); }; return <button onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "different-disabled-state",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={other} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "trailing-opaque-spread",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={isDisabling} onClick={action} {...props}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "disabled-overridden-false",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={isDisabling} disabled={false} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "negated-disabled",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={!isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "handler-shared-guarded-first",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <><button disabled={isDisabling} onClick={action}>One</button><button onClick={action}>Two</button></>; };\n',
    expectedCount: 1,
  },
  {
    name: "handler-shared-unguarded-first",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <><button onClick={action}>One</button><button disabled={isDisabling} onClick={action}>Two</button></>; };\n',
    expectedCount: 1,
  },
  {
    name: "opaque-handler-consumer",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; consume(action); return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "handler-alias",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; const alias=action; return <button disabled={isDisabling} onClick={alias}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "form-disabled-is-not-native-control",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <form disabled={isDisabling} onSubmit={action}><button>Run</button></form>; };\n',
    expectedCount: 1,
  },
  {
    name: "inline-native-button-positive",
    code: 'import { useState } from "react";\nexport const ActionButton=()=>{const [isDisabling,setIsDisabling]=useState(false);return <button disabled={isDisabling} onClick={async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}}>Run</button>;};\n',
    expectedCount: 0,
  },
  {
    name: "readonly-label-read-positive",
    code: 'import { useState } from "react";\nexport const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={isDisabling} onClick={action}>{isDisabling ? "Wait" : "Run"}</button>; };\n',
    expectedCount: 0,
  },
  {
    name: "false-reset-before-request",
    code: 'import { useState } from "react";\nexport const ActionButton=()=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{setIsDisabling(true);setIsDisabling(false);await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 1,
  },
  {
    name: "conditional-leading-flag",
    code: 'import { useState } from "react";\nexport const ActionButton=({ready})=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{if(ready)setIsDisabling(true);await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 1,
  },
  {
    name: "explicit-hook-replacement",
    code: 'import { useState } from "react";\nuseState=foreignHook; export const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "type-only-react-hook-runtime",
    code: 'import { useState } from "react";\nimport type {useState as useTypedState} from "react"; export const ActionButton=()=>{const [isDisabling,setIsDisabling]=useTypedState(false);const [,setDone]=useState(false);const action=async()=>{setIsDisabling(true);await fetch("/api/work",{method:"POST"});setDone(true);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 1,
  },
  {
    name: "react-namespace-carrier",
    code: 'import { useState } from "react";\nimport * as ReactRuntime from "react"; void ReactRuntime; export const ActionButton = (props) => { const [isDisabling,setIsDisabling]=useState(false); const [other]=useState(false); const action=async()=>{setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); }}; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "reset-before-later-mutating-await",
    code: 'import { useState } from "react";\nexport const ActionButton=()=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{setIsDisabling(true);await fetch("/api/work",{method:"POST"});setIsDisabling(false);await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 1,
  },
  {
    name: "sequential-reset-after-all-mutating-awaits",
    code: 'import { useState } from "react";\nexport const ActionButton=()=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{setIsDisabling(true);await fetch("/api/work",{method:"POST"});await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 0,
  },
  {
    name: "genuine-eval-reference-declines-lexical-closure",
    code: 'import { useState } from "react";\nexport const ActionButton = () => { void eval; const [isDisabling, setIsDisabling] = useState(false); const action = async () => { setIsDisabling(true); try { await fetch("/api/work", {method:"POST"}); } catch { setIsDisabling(false); } }; return <button disabled={isDisabling} onClick={action}>Run</button>; };\n',
    expectedCount: 1,
  },
  {
    name: "suspension-before-disabling-flag",
    code: 'import { useState } from "react";\nexport const ActionButton=({pending})=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{await pending;setIsDisabling(true);await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 1,
  },
  {
    name: "disabling-flag-before-any-suspension",
    code: 'import { useState } from "react";\nexport const ActionButton=({pending})=>{const [isDisabling,setIsDisabling]=useState(false);const action=async()=>{setIsDisabling(true);await pending;await fetch("/api/work",{method:"POST"});setIsDisabling(false);};return <button disabled={isDisabling} onClick={action}>Run</button>;};\n',
    expectedCount: 0,
  },
  {
    name: "runtime-enum-premature-disabling-reset",
    code: "import { useState } from 'react';\nexport const SaveButton = () => {\n  const [isDisabling, setIsDisabling] = useState(false);\n  const save = async () => {\n    setIsDisabling(true);\n    enum Phase { Ready = (setIsDisabling(false), 0) }\n    await fetch('/api/work', { method: 'POST' });\n    setIsDisabling(false);\n  };\n  return <button disabled={isDisabling} onClick={save}>Save</button>;\n};\n",
    expectedCount: 1,
  },
  {
    name: "ordinary-typed-local-keeps-linked-disabling-guard",
    code: "import { useState } from 'react';\nexport const SaveButton = () => {\n  const [isDisabling, setIsDisabling] = useState(false);\n  const save = async () => {\n    setIsDisabling(true);\n    const phase: number = 0;\n    void phase;\n    await fetch('/api/work', { method: 'POST' });\n    setIsDisabling(false);\n  };\n  return <button disabled={isDisabling} onClick={save}>Save</button>;\n};\n",
    expectedCount: 0,
  },
];

describe("linked disabling state on a native button", () => {
  it.each(linkedDisablingCases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, code, linkedDisablingOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
