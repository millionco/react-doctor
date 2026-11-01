import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderFunctionalSetstate } from "./rerender-functional-setstate.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useState = () => [0, () => {}];import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
  {
    name: "rejects opaque runtime imported provider exposure",
    code: 'import React from "react";function rewrite(){mutate(React);}rewrite();declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner interface",
    code: 'import React from "react";function rewrite(){interface React{}mutate(React);}rewrite();declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner type alias",
    code: 'import React from "react";function rewrite(){type React=unknown;mutate(React);}rewrite();declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath erased namespace",
    code: 'import React from "react";namespace ProofScope{namespace React{}mutate(React);}declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 1,
  },
  {
    name: "preserves genuine inner runtime provider shadow",
    code: 'import React from "react";function rewrite(){const React={};interface React{}mutate(React);}rewrite();declare const require: any;import { useState } from "react"; export const Counter = () => { const [count, setCount] = useState(0); const handleKey = (event) => { if (event.key === "Home") setCount(0); else if (event.key === "End") setCount(10); else setCount(count + 1); }; return <input onKeyDown={handleKey} value={count} />; };',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(rerenderFunctionalSetstate, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
