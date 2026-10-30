import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

const cases = [
  {
    name: "preserves an inert erased declaration",
    code: 'declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const require: any;",
    code: 'declare const require: any;require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface require {}",
    code: 'interface require {}require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type require from "provider-types";',
    code: 'import type require from "provider-types";require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects erased global carrier provider rewrites",
    code: 'declare const globalThis:any;globalThis.require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects erased global carrier alias provider rewrites",
    code: 'declare const globalThis:any;const world=globalThis;world.require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type require = require("provider-types");require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import require = require("provider-values");require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const require = () => ({}); interface require {}require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace require {}require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace require { export interface Marker {} }require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace require { export namespace Nested { export type Marker = unknown; } }require("react").useCallback = () => () => undefined;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace require {}import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace require { export const marker = 1; } void require;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
  {
    name: "rejects opaque runtime imported provider exposure",
    code: 'function rewrite(){mutate(React);}rewrite();declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner interface",
    code: 'function rewrite(){interface React{}mutate(React);}rewrite();declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath inner type alias",
    code: 'function rewrite(){type React=unknown;mutate(React);}rewrite();declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "rejects imported provider exposure beneath erased namespace",
    code: 'namespace ProofScope{namespace React{}mutate(React);}declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 1,
  },
  {
    name: "preserves genuine inner runtime provider shadow",
    code: 'function rewrite(){const React={};interface React{}mutate(React);}rewrite();declare const require: any;import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(clientPassiveEventListeners, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
