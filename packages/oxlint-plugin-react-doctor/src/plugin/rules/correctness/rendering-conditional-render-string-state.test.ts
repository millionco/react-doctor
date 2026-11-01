import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

interface StringStateScenario {
  name: string;
  source: string;
  expected: number;
}

const scenarios: StringStateScenario[] = [
  {
    name: "literal initializer with unused setter",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "literal setter",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "template setter",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(`${input} ready`);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "string on left",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready " + input);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "string on right",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(input + " ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "nested string concatenation",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize((input + " ") + input);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "multiple string writers",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready"); setResultSize(`${input}`);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "nested event writer",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst finish = () => setResultSize("ready"); finish();\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "type-only setter read",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\ntype Setter = typeof setResultSize;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "type-only getter read",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\ntype Value = typeof resultSize;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "function declaration",
    source:
      'import { useState } from "react";\nfunction label(value) { return `${value} items`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "const arrow",
    source:
      'import { useState } from "react";\nconst label = (value) => `${value} items`;\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "anonymous function expression",
    source:
      'import { useState } from "react";\nconst label = function(value) { return `${value} items`; };\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "string or undefined",
    source:
      'import { useState } from "react";\nfunction label(value) { if(value) return undefined; return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "string or bare return",
    source:
      'import { useState } from "react";\nfunction label(value) { if(value) return; return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "string or fallthrough",
    source:
      'import { useState } from "react";\nfunction label(value) { if(value) return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "nested numeric function return excluded",
    source:
      'import { useState } from "react";\nfunction label(value) { const ignored = () => 0; return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "nested numeric class return excluded",
    source:
      'import { useState } from "react";\nfunction label(value) { class Ignored { read() { return 0; } } return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "concatenation formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { return value + " items"; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "aliased named native useState",
    source:
      'import { useState as createState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = createState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "namespace native useState",
    source:
      'import * as React from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = React.useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "default native useState",
    source:
      'import React from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = React.useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 0,
  },
  {
    name: "numeric write",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(0);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "unknown write",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(input);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "boolean write remains unsupported",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(false);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "direct undefined write remains unsupported",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(undefined);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "functional updater",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(() => "ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter alias",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst update = setResultSize; update("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter escape",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconsume(setResultSize);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter JSX escape",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst button = <button onClick={setResultSize}/>;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter optional call",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize?.("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter spread arguments",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(...["ready"]);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter two arguments",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready", 0);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter no argument",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize();\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter call transport",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize.call(null, "ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter bind transport",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst update = setResultSize.bind(null);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter object transport",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst holder = { update: setResultSize };\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "setter array transport",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst updates = [setResultSize];\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "getter reassignment",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nresultSize = input;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "getter property write conservatively unsupported",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nresultSize.value = input;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "numeric formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { return 0; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "unknown formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { return value; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "mixed formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { if(value) return 0; return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "undefined-only formatter unsupported",
    source:
      'import { useState } from "react";\nfunction label(value) { return undefined; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "tagged template formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { return tag`${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "async formatter",
    source:
      'import { useState } from "react";\nasync function label(value) { return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "generator formatter",
    source:
      'import { useState } from "react";\nfunction* label(value) { return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "default formatter parameter",
    source:
      'import { useState } from "react";\nfunction label(value = 0) { return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "rest formatter parameter",
    source:
      'import { useState } from "react";\nfunction label(...values) { return `${values}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "pattern formatter parameter",
    source:
      'import { useState } from "react";\nfunction label({value}) { return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "escaped formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { return `${value}`; } consume(label);\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "mutable formatter",
    source:
      'import { useState } from "react";\nlet label = (value) => `${value}`;\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "formatter call alias",
    source:
      'import { useState } from "react";\nconst original = (value) => `${value}`; const label = original;\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "named function expression",
    source:
      'import { useState } from "react";\nconst label = function named(value) { return `${value}`; };\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "recursive formatter",
    source:
      'import { useState } from "react";\nfunction label(value) { if(value) return label(0); return `${value}`; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "numeric typed as string",
    source:
      'import { useState } from "react";\nfunction label(value): string { return 0 as string; }\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "imported formatter",
    source:
      'import { useState } from "react"; import { label } from "formatters";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize(label(input));\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "numeric initializer",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState(0);\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "string annotation alone",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState(0 as string);\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "lazy initializer",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState(() => "ready");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "template initializer unsupported",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState(`ready`);\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "unknown initializer",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState(input);\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "let tuple unsupported",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nlet [resultSize, setResultSize] = useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "missing setter binding",
    source:
      'import { useState } from "react"; const Example = () => {const [resultSize] = useState("");return <section>{resultSize && <output/>}</section>;};',
    expected: 1,
  },
  {
    name: "extra tuple element",
    source:
      'import { useState } from "react"; const Example = () => {const [resultSize,setResultSize,extra] = useState("");return <section>{resultSize && <output/>}</section>;};',
    expected: 1,
  },
  {
    name: "fake useState provider",
    source:
      'const useState = (value) => [0, () => {}];\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "type-only React provider",
    source:
      'import type { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nsetResultSize("ready");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "unbound useState",
    source:
      '\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "global React namespace",
    source:
      '\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = React.useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "replaced native namespace",
    source:
      'import * as React from "react"; React.useState = custom;\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = React.useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "escaped native namespace",
    source:
      'import * as React from "react"; consume(React);\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = React.useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "runtime eval exposure",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\neval(input);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "runtime Function exposure",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nFunction(input);\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "native provider constructor carrier",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst compile = (() => {}).constructor;\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "canonical require React exposure",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nconst other = require("react");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "dynamic React import exposure",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\nvoid import("react");\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "React module loader exposure",
    source:
      'import { useState } from "react"; import { createRequire } from "node:module";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "string state length legacy warning",
    source:
      'import { useState } from "react";\nexport const Example = (input: unknown) => {\nconst [resultSize, setResultSize] = useState("");\n\nreturn <section>{resultSize.length && <output>{resultSize}</output>}</section>;\n};',
    expected: 1,
  },
  {
    name: "unknown numeric identifier legacy warning",
    source: "const Example = ({ resultSize }) => <section>{resultSize && <output/>}</section>;",
    expected: 1,
  },
  {
    name: "boolean-result legacy quiet",
    source:
      "const resultSize = value > 0; const Example = () => <section>{resultSize && <output/>}</section>;",
    expected: 0,
  },
  {
    name: "independent direct local formatter proof also accepts the guard",
    source:
      "const label = (value) => `${value}`; const resultSize = label(input); const Example = () => <section>{resultSize && <output/>}</section>;",
    expected: 0,
  },
  {
    name: "visible native array iterator replacement",
    source:
      'import { useState } from "react";\nArray.prototype[Symbol.iterator] = function* () { yield 0; yield () => {}; };\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "native array readonly alias exposure",
    source:
      'import { useState } from "react";\nconst ArrayAlias = Array; ArrayAlias.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global namespace array exposure",
    source:
      'import { useState } from "react";\nglobalThis.Array.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global namespace alias array exposure",
    source:
      'import { useState } from "react";\nconst host = window; host.Array.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global namespace array destructure",
    source:
      'import { useState } from "react";\nconst {Array: ArrayAlias} = globalThis; ArrayAlias.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "native symbol exposure",
    source:
      'import { useState } from "react";\nconst iterationKey = Symbol.iterator;\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global symbol exposure",
    source:
      'import { useState } from "react";\nconst iterationKey = self.Symbol.iterator;\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "native object reflection exposure",
    source:
      'import { useState } from "react";\nconst prototype = Object.getPrototypeOf([]);\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global object reflection exposure",
    source:
      'import { useState } from "react";\nconst prototype = window.Object.getPrototypeOf([]);\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "native reflect exposure",
    source:
      'import { useState } from "react";\nReflect.set([], "unused", 1);\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "global reflect alias exposure",
    source:
      'import { useState } from "react";\nconst reflection = globalThis.Reflect; reflection.set([], "unused", 1);\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "literal array prototype projection",
    source:
      'import { useState } from "react";\nconst prototype = [].__proto__;\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "computed literal array prototype projection",
    source:
      'import { useState } from "react";\nconst prototype = []["__proto__"];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "prototype destructure",
    source:
      'import { useState } from "react";\nconst {__proto__: prototype} = [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "computed prototype destructure",
    source:
      'import { useState } from "react";\nconst {["__proto__"]: prototype} = [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 1,
  },
  {
    name: "shadowed array remains supported",
    source:
      'import { useState } from "react";\nconst Array = { prototype: {} }; Array.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "shadowed symbol remains supported",
    source:
      'import { useState } from "react";\nconst Symbol = {iterator: "local"}; const key = Symbol.iterator;\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "shadowed object remains supported",
    source:
      'import { useState } from "react";\nconst Object = {getPrototypeOf: () => null}; Object.getPrototypeOf([]);\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "shadowed reflect remains supported",
    source:
      'import { useState } from "react";\nconst Reflect = {set: () => {}}; Reflect.set();\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "shadowed namespace remains supported",
    source:
      'import { useState } from "react";\nconst window = {Array: {prototype: {}}}; window.Array.prototype.values = () => [];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "type-only native providers remain supported",
    source:
      'import { useState } from "react";\ntype Providers = [typeof Array, typeof Symbol, typeof Object, typeof Reflect];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
  {
    name: "unrelated local array remains supported",
    source:
      'import { useState } from "react";\nconst labels = ["ready"]; const label = labels[0];\nexport const Example = () => { const [resultSize, setResultSize] = useState(""); return <section>{resultSize && <output>{resultSize}</output>}</section>; };',
    expected: 0,
  },
];

describe("correctness/rendering-conditional-render closed string state", () => {
  it.each(scenarios)("$name", ({ source, expected }) => {
    const result = runRule(renderingConditionalRender, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
