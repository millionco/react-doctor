import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noBooleanToggleWithoutFunctionalUpdate } from "./no-boolean-toggle-without-functional-update.js";

const controls = [
  {
    name: "total branch assigned native listener with unsupported opaque parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "both branch functions contain stale toggle with unsupported opaque parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "functional updater branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen((previous) => !previous); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "ordinary click branch has no deferred registration",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  let listener;\n  if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n  return <button onClick={listener}>Toggle</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "overwritten before registration",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    listener = () => {};\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "registered before branches assign",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    target.addEventListener("change", listener);\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "shadowed branch binding is not registered outer binding",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { const listener = () => setOpen(!open); void listener; } else { const listener = () => setOpen(!open); void listener; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state dependency and matching cleanup refresh closure",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target, open]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal dead branch never supplies registered stale function",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (false) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "initial true state never selects stale else",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "render phase changes predicate before effects",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  if (mode) setMode(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "render helper changes predicate before effects",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const reset = () => setMode(false);\n  if (mode) reset();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "known const predicate selects harmless branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const selected = true;\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "defaulted helper predicate called without argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const install = (selected = true) => {\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n    };\n    return install();\n  }, [target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "mutated object destructuring selects harmless branch",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const settings = { selected: false };\n    settings.selected = true;\n    const { selected } = settings;\n    let listener;\n    if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "direct eval rewrites otherwise readonly predicate",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    eval("mode = true");\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "registration getter replaces callback before reading argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const native = new EventTarget();\n    const target = { get addEventListener() { listener = () => {}; return native.addEventListener.bind(native); }, removeEventListener: native.removeEventListener.bind(native) };\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "loop later overwrites selected callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    for (const selected of [false, true]) { if (selected) { listener = () => {}; } else { listener = () => setOpen(!open); } }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "event operand replaces handler before callback argument",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener((listener = () => {}, "change"), listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "initial false state with ordinary event setter with unsupported opaque parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "native target local constructor",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "known factory returns synchronous imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const createTarget = () => ({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n    const target = createTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "different state operand remains excluded",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!mode); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state dependency without cleanup does not refresh safely with unsupported opaque parameter",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n\n  }, [mode, target, open]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "latest ref guard remains excluded",
    code: 'import { useEffect, useState, useRef } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  const latest = useRef(open);\n  latest.current = open;\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => { if (latest.current === open) setOpen(!open); }; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state seed is synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target] = useState({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state replaced by synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  const initialize = () => setTarget({ addEventListener(event, callback) { callback(); }, removeEventListener() {} });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={initialize}>{String(open)}</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "state seed alias is synchronous event imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const imitation = { addEventListener(event, callback) { callback(); }, removeEventListener() {} };\n  const [target] = useState(imitation);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "whole parameter default is fixed by omitted caller argument",
    code: 'import { useEffect, useState } from "react";\nconst native = new EventTarget();\nconst useExample = ({ mode, target } = { mode: true, target: native }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return open;\n};\nexport const Example = () => <output>{String(useExample())}</output>;\n',
    diagnostics: [],
  },
  {
    name: "synchronous callback taking helper flips predicate during render",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const invoke = (callback) => callback();\n  if (mode) invoke(() => setMode(false));\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal null receiver cannot retain callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = null;\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "literal text receiver cannot retain callback",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = "text";\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state with unused setter has no native target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null state only receives null",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const [target, setTarget] = useState(null);\n  const reset = () => setTarget(null);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={reset}>{String(open)}</button>;\n};\n',
    diagnostics: [],
  },
  {
    name: "native method explicitly replaced with synchronous imitation",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    target.addEventListener = (event, callback) => callback();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "null seed state receives local native target and seed selected listener",
    code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
    diagnostics: [
      {
        message:
          "You can lose this update because setOpen(!open) reads a stale value; use setOpen(previous => !previous).",
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "stored JSX handler invoked during render",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(true);\n  const button = <button onClick={() => setMode(false)} />;\n  if (mode) button.props.onClick();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => {}; }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return button;\n};\n',
    diagnostics: [],
  },
  {
    name: "native global constructor explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nEventTarget = class { addEventListener(event, callback) { callback(); } removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "namespace native constructor explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nwindow.EventTarget = class { addEventListener(event, callback) { callback(); } removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic undefined is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    undefined.addEventListener("change", listener);\n    return () => undefined.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic NaN is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    NaN.addEventListener("change", listener);\n    return () => NaN.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "intrinsic Infinity is not an event target",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    Infinity.addEventListener("change", listener);\n    return () => Infinity.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "visible reflected native method replacement",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  Object.defineProperty(target, "addEventListener", { value(event, callback) { callback(); } });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "visible assigned native method replacement",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  Object.assign(target, { addEventListener(event, callback) { callback(); } });\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "const computed native method explicitly replaced",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  const target = new EventTarget();\n  const method = "addEventListener";\n  target[method] = (event, callback) => callback();\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "selected global event target explicitly reassigned",
    code: 'import { useEffect, useState } from "react";\nself = { addEventListener(event, callback) { callback(); }, removeEventListener() {} };\nexport const Example = ({ mode }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    self.addEventListener("change", listener);\n    return () => self.removeEventListener("change", listener);\n  }, [mode]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
  {
    name: "TypeScript wrapped direct eval fixes branch predicate before listener assignment",
    code: 'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    (eval as any)("mode = true");\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
    diagnostics: [],
  },
];

describe("no-boolean-toggle-without-functional-update — closed local branch listeners", () => {
  it.each(controls)("$name", ({ code, diagnostics }) => {
    expect(runRule(noBooleanToggleWithoutFunctionalUpdate, code)).toEqual({
      diagnostics,
      parseErrors: [],
    });
  });
});

describe("proven native branch listener counterparts", () => {
  it("native window: total branch assigned native listener", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    window.addEventListener("change", listener);\n    return () => window.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("native window: both branch functions contain stale toggle", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => setOpen(!open); } else { listener = () => setOpen(!open); }\n    window.addEventListener("change", listener);\n    return () => window.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(2);
  });
  it("native window: initial false state with ordinary event setter", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ target }) => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    window.addEventListener("change", listener);\n    return () => window.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("native window: state dependency without cleanup does not refresh safely", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    window.addEventListener("change", listener);\n\n  }, [mode, target, open]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
});

describe("closed receiver provider regressions", () => {
  it("known-immediate-component-prop", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n\nconst immediateTarget = { addEventListener(_event, callback) { callback(); }, removeEventListener() {} };\nexport const Root = () => <Example mode={false} target={immediateTarget} />;',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("known-repeated-browser-control", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n\nconst nativeTarget = new EventTarget();\nexport const Root = () => <Example mode={false} target={nativeTarget} />;',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("native-constructor-inside-effect", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("visible-Function-provider-override", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'Function("globalThis.EventTarget = class {addEventListener(_event, callback){callback()} removeEventListener(){}}")();\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("erased-native-constructor", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'interface EventTarget {note:string};\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("erased-native-window", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'interface window {note:string};\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    window.addEventListener("change", listener);\n    return () => window.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("erased-native-hook-import", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'interface useState {note:string};\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("erased-only-provider-type-pattern", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'type Notes = ({nested:{constructor}}:{nested:{constructor:string}})=>void; interface Function { note:string };\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("ambient-native-constructor-contract", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'declare function EventTarget(): unknown;\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("reflective-dynamic-provider", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'Reflect.get(globalThis,"Function")("globalThis.EventTarget = class {addEventListener(_event, callback){callback()} removeEventListener(){}}")();\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(0);
  });
});

describe("unindexed runtime provider references", () => {
  it("catch-default-function-provider", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'try { throw {}; } catch ({ ignored = Function("globalThis.EventTarget = class {addEventListener(_event, callback){callback()} removeEventListener(){}}")() }) {}\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("catch-default-function-alias", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'try{throw{}}catch({ignored=Function}){ignored("globalThis.EventTarget = class {addEventListener(_event, callback){callback()} removeEventListener(){}}")();}\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(0);
  });
  it("static-capability-property-names", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'const notes = { Function:"description", eval:"description", Reflect:"description" };\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
  it("erased-capability-import", () => {
    expect(
      runRule(
        noBooleanToggleWithoutFunctionalUpdate,
        'import type { Function } from "types-only";\nimport { useEffect, useState } from "react";\nexport const Example = ({ mode, target }) => {\n  const [open, setOpen] = useState(false);\n  useEffect(() => {\n    const target = new EventTarget();\n    let listener;\n    if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n    target.addEventListener("change", listener);\n    return () => target.removeEventListener("change", listener);\n  }, [mode, target]);\n  return <output>{String(open)}</output>;\n};\n',
      ).diagnostics,
    ).toHaveLength(1);
  });
});

describe("branch listeners with the production semantic context", () => {
  it.each(controls)("$name", ({ code, diagnostics }) => {
    expect(runRule(wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate), code)).toEqual({
      diagnostics,
      parseErrors: [],
    });
  });
});

it("preserves actual-host parenthesized receiver branch listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} (window).addEventListener("change",listener); return()=>(window).removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host as-any receiver branch listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} (window as any).addEventListener("change",listener); return()=>(window as any).removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host non-null receiver branch listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window!.addEventListener("change",listener); return()=>window!.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host parenthesized-listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",(listener)); return()=>window.removeEventListener("change",(listener)); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host as-any-listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",(listener as any)); return()=>window.removeEventListener("change",(listener as any)); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host non-null-listener", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener!); return()=>window.removeEventListener("change",listener!); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves actual-host parenthesized-events", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener(("change"),listener); return()=>window.removeEventListener(("change"),listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves no-op separator with parenthesized receiver", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} ;(window).addEventListener("change",listener); return()=>(window).removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves no-op separator with as-any receiver", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} ;(window as any).addEventListener("change",listener); return()=>(window as any).removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

it("preserves no-op separator with non-null receiver", () => {
  expect(
    runRule(
      wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate),
      'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} ;window!.addEventListener("change",listener); return()=>window!.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
    ).diagnostics,
  ).toHaveLength(1);
});

describe("final expression and provider boundaries", () => {
  it.each([
    {
      name: "final-expression-admission-nominal",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-events-as-const",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener(("change" as const),listener);return()=>window.removeEventListener(("change" as const),listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-events-non-null",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener(("change"!),listener);return()=>window.removeEventListener(("change"!),listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-predicate-as-boolean",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode as boolean){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-predicate-non-null",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode!){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-assignment-lhs-as-any",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){(listener as any)=()=>{};}else{(listener as any)=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-assignment-lhs-non-null",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){(listener!)=()=>{};}else{(listener!)=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-assignment-rhs-as-any",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=(()=>{}) as any;}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-assignment-rhs-non-null",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=(()=>setOpen(!open))!;}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-member-call-callee-as-any",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}(window.addEventListener as any)("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-cleanup-callee-as-any",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>(window.removeEventListener as any)("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-registration-result-as-void",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}(window.addEventListener("change",listener) as void);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-effect-callback-as-any",
      code: 'import { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect((()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);}) as any,[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
    {
      name: "final-expression-admission-state-native-receiver-guard-as-cast",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target as EventTarget) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "provider-wrapper-nominal",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-wrapper-direct-method-write",
      code: 'const syncRegistrar = (_event, callback) => callback();\nwindow.addEventListener = syncRegistrar;\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-wrapped-method-write",
      code: 'const syncRegistrar = (_event, callback) => callback();\n(window.addEventListener as any) = syncRegistrar;\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-direct-object-assign",
      code: 'const syncRegistrar = (_event, callback) => callback();\nObject.assign(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-wrapped-object-assign",
      code: 'const syncRegistrar = (_event, callback) => callback();\n(Object as any).assign(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-aliased-object-assign",
      code: 'const syncRegistrar = (_event, callback) => callback();\nconst patch = Object.assign; patch(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-cast-object-assign-callee",
      code: 'const syncRegistrar = (_event, callback) => callback();\n(Object.assign as any)(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-escaped-object-namespace",
      code: 'const syncRegistrar = (_event, callback) => callback();\nconst namespace = Object; namespace.assign(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-global-object-namespace-assign",
      code: 'const syncRegistrar = (_event, callback) => callback();\nglobalThis.Object.assign(window, {addEventListener: syncRegistrar});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-ordinary-object-keys",
      code: 'const names = Object.keys({note: true});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-wrapper-ordinary-object-freeze",
      code: 'const notes = Object.freeze({note: true});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-wrapper-direct-predicate-write",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{mode=true; let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-wrapper-wrapped-predicate-write",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{(mode as any)=true; let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-final-extra-shadowed-object-freeze",
      code: 'const Object = {freeze: (_value) => { window.addEventListener = (_event, callback) => callback(); }}; Object.freeze({});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-final-extra-global-reflect-escape",
      code: 'const reflection = globalThis.Reflect;\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-final-extra-global-object-keys",
      code: 'globalThis.Object.keys({});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-final-extra-erased-object-keys",
      code: 'interface Object {}\nObject.keys({});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-final-extra-erased-global-object-keys",
      code: 'interface globalThis {}\nglobalThis.Object.keys({});\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "provider-final-extra-legacy-prototype-getter-capability",
      code: 'class SynchronousTarget { addEventListener(_event,callback){ callback(); } removeEventListener(){} } const installGetter = Object.prototype.__defineGetter__; installGetter.call(globalThis,"EventTarget",()=>SynchronousTarget);\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ const target = new EventTarget(); let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-final-extra-legacy-window-method-getter-capability",
      code: 'const syncRegistrar = (_event, callback) => callback(); Object.prototype.__defineGetter__.call(window,"addEventListener",()=>syncRegistrar);\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "provider-final-extra-legacy-global-object-prototype-escape",
      code: 'const legacy = globalThis.Object.prototype;\nimport { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} window.addEventListener("change",listener); return()=>window.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 0,
    },
    {
      name: "native-transparent-seed-native-constructor",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ const target = new EventTarget(); let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-initializer-as",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ const target = (new EventTarget() as EventTarget); let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-initializer-non-null",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ const target = new EventTarget()!; let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-audio-callee-as",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); useEffect(()=>{ const target = new (Audio as any)(); let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-state-seed",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); const [target, setTarget] = useState(new EventTarget()); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-state-seed-as",
      code: 'import { useEffect, useState } from "react"; export const Example = ({mode}) => { const [open,setOpen] = useState(false); const [target, setTarget] = useState((new EventTarget() as EventTarget)); useEffect(()=>{ let listener; if(mode){listener=()=>{}}else{listener=()=>setOpen(!open)} target.addEventListener("change",listener); return()=>target.removeEventListener("change",listener); },[mode]); return <output>{String(open)}</output>; };',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-state-setter-as",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget as EventTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "native-transparent-seed-native-state-initializer-as",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = (new EventTarget() as EventTarget);\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "raw-fuzz-replay-no-boolean-toggle-without-functional-update-verdict-drop-seed-42000347-1",
      code: '// rule: no-boolean-toggle-without-functional-update\n// kind: verdict-drop\n// seed: 42000347 (iteration 221)\n// variant: parenthesized call receivers\n// detail: diagnostics disappeared under verdict-preserving rewrite "parenthesized call receivers" (base had 1)\nimport * as ReactQuery from "@tanstack/react-query";\nimport { useQuery, useMutation } from "@tanstack/react-query";\nimport dynamic from "next/dynamic";\nimport { create as createZustandStore } from "zustand"; const useFuzzZustandStore = createZustandStore(() => ({ value: 0 }));\nimport { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => <button>{props.label}</button>);\n\nconst FuzzBranchNativeListener = ({ mode }) => { const [open, setOpen] = useState(false); useEffect(() => { let listener; if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); } ;(window).addEventListener("change", listener); return () => (window).removeEventListener("change", listener); }, [mode]); return <output>{String(open)}</output>; };\n\nconst useFuzzToggle76 = (initial) => {\n  const stored = useRef(initial);\n  useEffect(() => { stored.current = initial; });\n  return useCallback(() => stored.current, []);\n};\n\nconst FuzzOverlay4 = () => {\n  const [counterState, dispatchCounter] = useReducer((state, action) => { state.count += 1; return state; }, { count: 0 });\n  useEffect(() => { let isActive = true; let timeoutId; ;(fetch(url)).then(() => { if (!isActive) return; timeoutId = setTimeout(handle, 100); }); return () => { isActive = false; if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); } }; }, [url, shouldSkipRelease]);\n  const handleSubmit = async () => { setLoading(true); const result = await (api).post(url, values); setState(result); setLoading(false); };\n  const handlePersistToken = () => { ;(localStorage).setItem("auth_token", String(value)); };\n  const savingRef = useRef(false);\n  const handleGuardedSave = async () => {\n    if (savingRef.current) return;\n    savingRef.current = true;\n    await (api).post(url, values);\n    setState(true);\n    savingRef.current = false;\n  };\n  return (<li>{createPortal(<div>{state}</div>, document.body)}</li>);\n};\n',
      expected: 1,
    },
    {
      name: "raw-fuzz-replay-no-boolean-toggle-without-functional-update-verdict-drop-seed-42000347-2",
      code: '// rule: no-boolean-toggle-without-functional-update\n// kind: verdict-drop\n// seed: 42000347 (iteration 221)\n// variant: as-any call receivers\n// detail: diagnostics disappeared under verdict-preserving rewrite "as-any call receivers" (base had 1)\nimport * as ReactQuery from "@tanstack/react-query";\nimport { useQuery, useMutation } from "@tanstack/react-query";\nimport dynamic from "next/dynamic";\nimport { create as createZustandStore } from "zustand"; const useFuzzZustandStore = createZustandStore(() => ({ value: 0 }));\nimport { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => <button>{props.label}</button>);\n\nconst FuzzBranchNativeListener = ({ mode }) => { const [open, setOpen] = useState(false); useEffect(() => { let listener; if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); } ;(window as any).addEventListener("change", listener); return () => (window as any).removeEventListener("change", listener); }, [mode]); return <output>{String(open)}</output>; };\n\nconst useFuzzToggle76 = (initial) => {\n  const stored = useRef(initial);\n  useEffect(() => { stored.current = initial; });\n  return useCallback(() => stored.current, []);\n};\n\nconst FuzzOverlay4 = () => {\n  const [counterState, dispatchCounter] = useReducer((state, action) => { state.count += 1; return state; }, { count: 0 });\n  useEffect(() => { let isActive = true; let timeoutId; ;(fetch(url) as any).then(() => { if (!isActive) return; timeoutId = setTimeout(handle, 100); }); return () => { isActive = false; if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); } }; }, [url, shouldSkipRelease]);\n  const handleSubmit = async () => { setLoading(true); const result = await (api as any).post(url, values); setState(result); setLoading(false); };\n  const handlePersistToken = () => { ;(localStorage as any).setItem("auth_token", String(value)); };\n  const savingRef = useRef(false);\n  const handleGuardedSave = async () => {\n    if (savingRef.current) return;\n    savingRef.current = true;\n    await (api as any).post(url, values);\n    setState(true);\n    savingRef.current = false;\n  };\n  return (<li>{createPortal(<div>{state}</div>, document.body)}</li>);\n};\n',
      expected: 1,
    },
    {
      name: "raw-fuzz-replay-no-boolean-toggle-without-functional-update-verdict-drop-seed-42000347-3",
      code: '// rule: no-boolean-toggle-without-functional-update\n// kind: verdict-drop\n// seed: 42000347 (iteration 221)\n// variant: non-null-asserted call receivers\n// detail: diagnostics disappeared under verdict-preserving rewrite "non-null-asserted call receivers" (base had 1)\nimport * as ReactQuery from "@tanstack/react-query";\nimport { useQuery, useMutation } from "@tanstack/react-query";\nimport dynamic from "next/dynamic";\nimport { create as createZustandStore } from "zustand"; const useFuzzZustandStore = createZustandStore(() => ({ value: 0 }));\nimport { forwardRef } from "react";\nconst FuzzForwardRefComponent = forwardRef((props) => <button>{props.label}</button>);\n\nconst FuzzBranchNativeListener = ({ mode }) => { const [open, setOpen] = useState(false); useEffect(() => { let listener; if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); } ;(window!).addEventListener("change", listener); return () => (window!).removeEventListener("change", listener); }, [mode]); return <output>{String(open)}</output>; };\n\nconst useFuzzToggle76 = (initial) => {\n  const stored = useRef(initial);\n  useEffect(() => { stored.current = initial; });\n  return useCallback(() => stored.current, []);\n};\n\nconst FuzzOverlay4 = () => {\n  const [counterState, dispatchCounter] = useReducer((state, action) => { state.count += 1; return state; }, { count: 0 });\n  useEffect(() => { let isActive = true; let timeoutId; ;(fetch(url)!).then(() => { if (!isActive) return; timeoutId = setTimeout(handle, 100); }); return () => { isActive = false; if (timeoutId) { if (shouldSkipRelease) return; clearTimeout(timeoutId); } }; }, [url, shouldSkipRelease]);\n  const handleSubmit = async () => { setLoading(true); const result = await (api!).post(url, values); setState(result); setLoading(false); };\n  const handlePersistToken = () => { ;(localStorage!).setItem("auth_token", String(value)); };\n  const savingRef = useRef(false);\n  const handleGuardedSave = async () => {\n    if (savingRef.current) return;\n    savingRef.current = true;\n    await (api!).post(url, values);\n    setState(true);\n    savingRef.current = false;\n  };\n  return (<li>{createPortal(<div>{state}</div>, document.body)}</li>);\n};\n',
      expected: 1,
    },
    {
      name: "unrelated-const-alias-chain",
      code: 'const unrelatedValue0 = 0; const unrelatedValue1 = unrelatedValue0; const unrelatedValue2 = unrelatedValue1; const unrelatedValue3 = unrelatedValue2; const unrelatedValue4 = unrelatedValue3; const unrelatedValue5 = unrelatedValue4; const unrelatedValue6 = unrelatedValue5; const unrelatedValue7 = unrelatedValue6; const unrelatedValue8 = unrelatedValue7; const unrelatedValue9 = unrelatedValue8; const unrelatedValue10 = unrelatedValue9; const unrelatedValue11 = unrelatedValue10; const unrelatedValue12 = unrelatedValue11; const unrelatedValue13 = unrelatedValue12; const unrelatedValue14 = unrelatedValue13; const unrelatedValue15 = unrelatedValue14; const unrelatedValue16 = unrelatedValue15; const unrelatedValue17 = unrelatedValue16; const unrelatedValue18 = unrelatedValue17; const unrelatedValue19 = unrelatedValue18; const unrelatedValue20 = unrelatedValue19; const unrelatedValue21 = unrelatedValue20; const unrelatedValue22 = unrelatedValue21; const unrelatedValue23 = unrelatedValue22; const unrelatedValue24 = unrelatedValue23; const unrelatedValue25 = unrelatedValue24; const unrelatedValue26 = unrelatedValue25; const unrelatedValue27 = unrelatedValue26; const unrelatedValue28 = unrelatedValue27; const unrelatedValue29 = unrelatedValue28; const unrelatedValue30 = unrelatedValue29; const unrelatedValue31 = unrelatedValue30; const unrelatedValue32 = unrelatedValue31; const unrelatedValue33 = unrelatedValue32; const unrelatedValue34 = unrelatedValue33; const unrelatedValue35 = unrelatedValue34; const unrelatedValue36 = unrelatedValue35; const unrelatedValue37 = unrelatedValue36; const unrelatedValue38 = unrelatedValue37; const unrelatedValue39 = unrelatedValue38; const unrelatedValue40 = unrelatedValue39; const unrelatedValue41 = unrelatedValue40; const unrelatedValue42 = unrelatedValue41; const unrelatedValue43 = unrelatedValue42; const unrelatedValue44 = unrelatedValue43; const unrelatedValue45 = unrelatedValue44; const unrelatedValue46 = unrelatedValue45; const unrelatedValue47 = unrelatedValue46; const unrelatedValue48 = unrelatedValue47; const unrelatedValue49 = unrelatedValue48; const unrelatedValue50 = unrelatedValue49; const unrelatedValue51 = unrelatedValue50; const unrelatedValue52 = unrelatedValue51; const unrelatedValue53 = unrelatedValue52; const unrelatedValue54 = unrelatedValue53; const unrelatedValue55 = unrelatedValue54; const unrelatedValue56 = unrelatedValue55; const unrelatedValue57 = unrelatedValue56; const unrelatedValue58 = unrelatedValue57; const unrelatedValue59 = unrelatedValue58; const unrelatedValue60 = unrelatedValue59; const unrelatedValue61 = unrelatedValue60; const unrelatedValue62 = unrelatedValue61; const unrelatedValue63 = unrelatedValue62; const unrelatedValue64 = unrelatedValue63;\nimport { useEffect,useState } from "react"; export const Example=({mode})=>{const[open,setOpen]=useState(false);useEffect(()=>{let listener;if(mode){listener=()=>{};}else{listener=()=>setOpen(!open);}window.addEventListener("change",listener);return()=>window.removeEventListener("change",listener);},[mode]);return <output>{String(open)}</output>;};',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate), code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

describe("nullable state transparent values", () => {
  it.each([
    {
      name: "nullable-seed-as-null",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null as null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "nullable-setter",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget); setTarget(null);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "nullable-setter-as-null",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget); setTarget(null as null);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "native-setter-callee-as",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    (setTarget as any)(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "predicate-seed-as-boolean",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false as boolean);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => setMode(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
    {
      name: "predicate-setter-callee-as",
      code: 'import { useEffect, useState } from "react";\nexport const Example = () => {\n  const [open, setOpen] = useState(false);\n  const [mode, setMode] = useState(false);\n  const [target, setTarget] = useState(null);\n  const changeMode = () => (setMode as any)(!mode);\n  useEffect(() => {\n    const nativeTarget = new EventTarget();\n    setTarget(nativeTarget);\n  }, []);\n  useEffect(() => {\n    if (target) {\n      let listener;\n      if (mode) { listener = () => {}; } else { listener = () => setOpen(!open); }\n      target.addEventListener("change", listener);\n      return () => target.removeEventListener("change", listener);\n    }\n  }, [mode, target]);\n  return <button onClick={changeMode}>{String(open)}</button>;\n};\n',
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(wrapWithSemanticContext(noBooleanToggleWithoutFunctionalUpdate), code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
