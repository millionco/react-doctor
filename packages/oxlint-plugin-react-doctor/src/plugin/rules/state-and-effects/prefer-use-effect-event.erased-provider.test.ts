import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useCallback = () => () => undefined;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
  {
    name: "rejects opaque runtime imported provider exposure",
    code: 'import React from "react";function rewrite(){mutate(React);}rewrite();declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner interface",
    code: 'import React from "react";function rewrite(){interface React{}mutate(React);}rewrite();declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner type alias",
    code: 'import React from "react";function rewrite(){type React=unknown;mutate(React);}rewrite();declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath erased namespace",
    code: 'import React from "react";namespace ProofScope{namespace React{}mutate(React);}declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 1,
  },
  {
    name: "preserves genuine inner runtime provider shadow",
    code: 'import React from "react";function rewrite(){const React={};interface React{}mutate(React);}rewrite();declare const require: any;import { useCallback, useEffect } from "react"; export const Example = ({ active, value }) => { const leaf = useCallback(() => "ready", []); const callback = useCallback(() => leaf(), [leaf]); useEffect(() => { const timer = setTimeout(() => callback(), 0); return () => clearTimeout(timer); }, [callback, active]); return null; };',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(preferUseEffectEvent, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
