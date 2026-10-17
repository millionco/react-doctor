import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects erased native tuple provider writes",
    code: 'declare const Array:any; declare const Symbol:any;Array.prototype[Symbol.iterator] = function* () { yield 0; yield () => {}; };import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useTransition = () => [false, () => {}];import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 0,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import { useEffect, useState, useTransition } from "react";\nexport const Example = ({value}) => { const [text, writeText] = useState(""); const [pending, startTransition] = useTransition(); useEffect(() => { startTransition(async () => { await Promise.resolve(value); writeText(value); }); }, [value]); return <output>{pending ? "waiting" : text}</output>; };\n',
    expected: 1,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(noSetStateAfterAwaitInEffect, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
