import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noEffectChain } from "./no-effect-chain.js";

interface NavigationFocusFixture {
  readonly name: string;
  readonly source: string;
  readonly expectedStates: readonly string[];
  readonly files: Readonly<Record<string, string>>;
}

const fixtures: ReadonlyArray<NavigationFocusFixture> = [
  {
    name: "false close leaves only snapshot native focus and initial reset",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "false close leaves only guarded direct current focus and initial reset",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    if (field.current) {\n      field.current.focus();\n    }\n    setPosition(EMPTY_POSITION);\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (active) {\n      if (opened) {\n        if (position > 0) setPosition(previous => previous - 1);\n        else if (position === 0) reset();\n      } else if (position === 0) reset();\n    }\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "direct readonly own helper retains closed purpose",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = () => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  };\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "styled native input through relative barrel retains closed purpose",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nimport { Field } from \"./parts\";\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <Field ref={field} />;\n}\n",
    expectedStates: [],
    files: {
      "parts/index.ts": 'export { Field } from "./hosts";',
      "parts/hosts.tsx":
        'import styled from "styled-components"; export const Field=styled.input``;',
    },
  },
  {
    name: "readonly false alias retains existing static writer facts",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { const closed = false; setOpened(closed); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "true writer preserves reachable navigation work",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(true); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "unknown writer remains an ordinary chain",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(source); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "mixed true and false writes preserve ordinary behavior",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); if (source) setOpened(true); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "zero writer does not use boolean close exception",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(0); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "null writer does not use boolean close exception",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(null); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "reachable sibling derived state is still work",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset(); setTotal(position * 5);\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "reachable prop callback remains work",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset(); onObserve();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "decrement outside visibility guard remains work",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "negated visibility branch keeps its state chain",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (!opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "extra helper work declines its frame certificate",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus(); onObserve();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "dynamic reset is not an initial numeric reset",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(source);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "different numeric reset is not the initial sentinel",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(0);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "updater reset is not a literal initial reset",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(() => EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "escaped helper declines closed reference census",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  onInstall(reset);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "aliased helper call declines closed direct-call census",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) { const forward = reset; forward(); }\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "escaped state setter declines owned reset state",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  onInstall(setPosition);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "useMemo does not act as a useCallback provider",
    source:
      "import { useMemo, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useMemo(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "local callback hook spelling is not genuine React",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const useCallback = callback => callback;\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "visible sibling default hook replacement declines certificate",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nimport React from \"react\";\nReact.useCallback = foreign;\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "custom input host declines native certificate",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <CustomField ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "polymorphic selected input declines native certificate",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input as=\"button\" ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "visible native method replacement declines certificate",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { if (field.current) field.current.focus = foreign; }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "independent incoming state edge remains",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => { setOther(1); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, other, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["other"],
    files: {},
  },
  {
    name: "outgoing index state chain remains",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  useEffect(() => { setTotal(position + 5); }, [position]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["position"],
    files: {},
  },
  {
    name: "useCallback dependency role alone does not escape helper",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const secondary = useCallback(() => { reset(); }, [reset]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "reached sibling default hook replacement declines native provider proof",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nimport \"./provider\";\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {
      "provider.ts": 'import React from "react"; React.useCallback = callback => () => foreign();',
    },
  },
  {
    name: "genuine memoized pointer and keyboard listeners with effect dependencies retain owned focus",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "memoized listener preserves ordinary owned ancestor contains purpose",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const container = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (!container.current?.contains(event.target)) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <div ref={container}><input ref={field} /></div>;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "readonly const listener alias retains outer factory origin",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  const keyboardAlias = handleKeyboard;\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', keyboardAlias);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', keyboardAlias);\n    };\n  }, [handlePointer, keyboardAlias]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: [],
    files: {},
  },
  {
    name: "reached default useCallback provider replacement refuses memoized listeners",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nimport './changed-hook';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {
      "changed-hook.ts":
        "import React from 'react'; React.useCallback = callback => () => foreign();",
    },
  },
  {
    name: "unknown listener factory does not borrow callback identity",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = makeListener(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "escaped memoized listener declines complete readonly use role",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  onInstall(handleKeyboard);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener event target opaque mutation remains refused",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    event.target[opaque] = replacement;\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener event currentTarget escape remains refused",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    onObserve(event.currentTarget);\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "async memoized listener remains unsupported",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(async ({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener dependency argument must be literal array",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const listenerDependencies = [reset];\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, listenerDependencies);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener spread dependency argument remains refused",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, ...[[reset]]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener implicit arguments remains refused",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(function () {\n    onObserve(arguments[0]);\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener implicit global event remains refused",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (event.key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
  {
    name: "memoized listener does not excuse selected native method replacement",
    source:
      "import { useCallback, useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction FieldNavigator({ source, active = true, onObserve = () => {}, onInstall = () => {} }) {\n  const [opened, setOpened] = useState(true);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const field = useRef(null);\n  const reset = useCallback(() => {\n    const element = field.current;\n    if (element) {\n      element.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  }, []);\n  const handlePointer = useCallback(event => {\n    if (field.current === event.target) reset();\n  }, [reset]);\n  const handleKeyboard = useCallback(({ key }) => {\n    if (key === 'Escape') reset();\n  }, [reset]);\n  useEffect(() => {\n    window.addEventListener('click', handlePointer);\n    window.addEventListener('keydown', handleKeyboard);\n    return () => {\n      window.removeEventListener('click', handlePointer);\n      window.removeEventListener('keydown', handleKeyboard);\n    };\n  }, [handlePointer, handleKeyboard]);\n  if (field.current) field.current.focus = foreign;\n  useEffect(() => { setOpened(false); }, [source]);\n  useEffect(() => {\n    if (opened && active && position > 0) {\n      setPosition(position - 1);\n    }\n    if (active && position === 0) reset();\n  }, [opened, reset]);\n  return <input ref={field} />;\n}\n",
    expectedStates: ["opened"],
    files: {},
  },
];

describe("noEffectChain owned close-edge native input focus", () => {
  it.each(fixtures)("$name", (fixture) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "navigation-focus-integration-"),
    );
    try {
      const filename = path.join(root, "field-navigator.tsx");
      const files = {
        "package.json": JSON.stringify({
          private: true,
          dependencies: { react: "18.2.0", "react-dom": "18.2.0", "styled-components": "5.3.11" },
        }),
        ...fixture.files,
        "field-navigator.tsx": fixture.source,
      };
      for (const [relativePath, source] of Object.entries(files)) {
        const destination = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, source);
      }
      resetFilesystemCaches();
      const result = runRule(noEffectChain, fixture.source, { filename, includeLocations: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
        fixture.expectedStates.map(
          (state) =>
            `Your screen redraws several times from a single action because one useEffect changes "${state}", which sets off this one.`,
        ),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      resetFilesystemCaches();
    }
  });
});
