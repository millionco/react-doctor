import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderLazyRefInit } from "./rerender-lazy-ref-init.js";

describe("rerender-lazy-ref-init — regressions", () => {
  it("flags a trivial-name construction with runtime arguments", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const byKey = useRef(new Map([["a", 1]]));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a trivial-name construction with a spread argument", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C({ iterables }) {
        const byKey = useRef(new Map(...iterables));
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `new Date()` with and without an argument", () => {
    const withArgument = runRule(
      rerenderLazyRefInit,
      `function C({ timestamp }) {
        const startedAt = useRef(new Date(timestamp));
        return null;
      }`,
    );
    const zeroArgument = runRule(
      rerenderLazyRefInit,
      `function C() {
        const startedAt = useRef(new Date());
        return null;
      }`,
    );
    expect(withArgument.diagnostics).toHaveLength(1);
    expect(zeroArgument.diagnostics).toHaveLength(1);
  });

  it("flags a member-expression callee even when the property matches a trivial name", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const byKey = useRef(new ns.Map());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for an empty built-in registry with only type arguments", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const byKey = useRef(new Map<string, number>());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a TS-wrapped empty built-in registry", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const seen = useRef(new Set() as Set<string>);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a TS-wrapped expensive construction (wrapper transparency)", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C({ config }) {
        const model = useRef(new HeavyModel(config) as Model);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a proven alias of an empty built-in registry", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const M = Map;
        const byKey = useRef(new M());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for an empty registry from the global object", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `function C() {
        const byKey = useRef(new globalThis.Map());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a shadowing binding of a built-in constructor name", () => {
    const result = runRule(
      rerenderLazyRefInit,
      `import { Map } from "immutable";
      function C() {
        const byKey = useRef(new Map());
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      name: "a renamed React useMemo import",
      code: 'import { useMemo as memo, useRef } from "react"; const Component = () => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "an immutable alias of a React hook",
      code: 'import { useMemo, useRef } from "react"; const memo = useMemo; const Component = () => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a destructured React hook alias",
      code: 'import * as React from "react"; const { useMemo: memo } = React; const Component = () => { const reference = React.useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a static computed React hook",
      code: 'import * as React from "react"; const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a static template React hook",
      code: 'import * as React from "react"; const Component = () => { const reference = React.useRef(React[`useMemo`](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a typed static computed React hook",
      code: 'import * as React from "react"; const Component = () => { const reference = React.useRef((React as typeof React)["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a typed namespace escape",
      code: 'import * as React from "react"; configure(React as typeof React); const Component = () => { const reference = React.useRef((React as typeof React)["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a typed namespace property replacement",
      code: 'import * as React from "react"; (React as typeof React).useMemo = expensive; const Component = () => { const reference = React.useRef((React as typeof React)["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "existing direct and local custom hook calls",
      code: 'import { useMemo, useRef } from "react"; const useCached = () => expensive(); const Component = () => { const direct = useRef(useMemo(() => expensive(), [])); const custom = useRef(useCached()); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a foreign memo import",
      code: 'import { useRef } from "react"; import { memo } from "./cache"; const Component = () => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a shadowed hook alias",
      code: 'import { useMemo as memo, useRef } from "react"; const Component = (memo) => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a reassigned hook alias",
      code: 'import { useMemo, useRef } from "react"; let memo = useMemo; memo = expensive; const Component = () => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a dynamic React member",
      code: 'import * as React from "react"; const Component = ({ method }) => { const reference = React.useRef(React[method](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a userland React-shaped object",
      code: 'import { useRef } from "react"; const React = { useMemo: expensive }; const Component = () => { const reference = useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "the non-hook React memo API",
      code: 'import { memo, useRef } from "react"; const Component = () => { const reference = useRef(memo(Child)); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a hook alias used as a constructor",
      code: 'import { useMemo as Factory, useRef } from "react"; const Component = () => { const reference = useRef(new Factory()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an ordinary eager initializer",
      code: 'import { useRef } from "react"; const Component = () => { const reference = useRef(expensive()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a replaced namespace hook",
      code: 'import React from "react"; React.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a hook extracted after namespace replacement",
      code: 'import React from "react"; React.useMemo = expensive; const { useMemo: memo } = React; const Component = () => { const reference = React.useRef(memo()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a namespace changed by Object.assign",
      code: 'import React from "react"; Object.assign(React, { useMemo: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a namespace changed by Object.defineProperty",
      code: 'import React from "react"; Object.defineProperty(React, "useMemo", { value: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a namespace escaped before hook extraction",
      code: 'import React from "react"; configure(React); const { useMemo: memo } = React; const Component = () => { const reference = React.useRef(memo()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a namespace mutation through a const alias",
      code: 'import React from "react"; const Client = React; Client.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a namespace escaped through a const alias",
      code: 'import React from "react"; const Client = React; configure(Client); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a different same-provider namespace write",
      code: 'import React from "react"; import * as Other from "react"; Other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a different same-provider namespace escape",
      code: 'import React from "react"; import * as Other from "react"; configure(Other); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unmodified second same-provider namespace",
      code: 'import React from "react"; import * as Other from "react"; const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); const value = Other.version; return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a mixed conditional hook alias",
      code: 'import { useMemo, useRef } from "react"; const memo = condition ? useMemo : expensive; const Component = () => { const reference = useRef(memo()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unsupported all-hook conditional alias",
      code: 'import { useMemo, useCallback, useRef } from "react"; const memo = condition ? useMemo : useCallback; const Component = () => { const reference = useRef(memo()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unsupported unbound computed React namespace",
      code: 'const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a direct namespace member after replacement retaining old name behavior",
      code: 'import React from "react"; React.useMemo = expensive; const Component = () => { const reference = React.useRef(React.useMemo()); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a namespace with another property assigned",
      code: 'import React from "react"; React.version = "test"; const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a same-provider CommonJS property replacement",
      code: 'import React from "react"; Object.defineProperty(require("react"), "useMemo", { value: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider CommonJS namespace write",
      code: 'import React from "react"; const Other = require("react"); Other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider CommonJS namespace escape",
      code: 'import React from "react"; const Other = require("react"); configure(Other); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider dynamic import escape",
      code: 'import React from "react"; import("react").then(configure); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unknown dynamic provider access",
      code: 'import React from "react"; import(provider).then(configure); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unknown require provider access",
      code: 'import React from "react"; configure(require(provider)); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unrelated static require",
      code: 'import React from "react"; const other = require("./other"); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "an unrelated static dynamic import",
      code: 'import React from "react"; import("./other"); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a require capability alias",
      code: 'import React from "react"; const load = require; Object.assign(load("react"), { useMemo: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider TypeScript import-equals write",
      code: 'import React from "react"; import Other = require("react"); Other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a createRequire provider escape",
      code: 'import React from "react"; import { createRequire } from "node:module"; const load = createRequire(import.meta.url); configure(load("react")); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider module.require mutation",
      code: 'import React from "react"; Object.assign(module.require("react"), { useMemo: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a same-provider global require mutation",
      code: 'import React from "react"; Object.assign(globalThis.require("react"), { useMemo: expensive }); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unsupported preact namespace Hook alias",
      code: 'import * as React from "preact/compat"; const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unsupported preact named Hook alias",
      code: 'import { useMemo as memo, useRef } from "preact/compat"; const Component = () => { const reference = useRef(memo(() => expensive(), [])); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a borrowed module.require capability",
      code: 'import React from "react"; let load = module.require; const other = load.call(module, "react"); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a borrowed global require capability",
      code: 'import React from "react"; let load = globalThis.require; const other = load("react"); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a reflected global loader",
      code: 'import React from "react"; const other = Reflect.get(globalThis, "require")("react"); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a reflected loader through a global object alias",
      code: 'import React from "react"; const host = globalThis; const other = Reflect.get(host, "require")("react"); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a global object passed to an opaque callback",
      code: 'import React from "react"; configure(global); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a browser global object passed to an opaque callback",
      code: 'import React from "react"; configure(window); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a worker global object passed to an opaque callback",
      code: 'import React from "react"; configure(self); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a typed global object passed as a value",
      code: 'import React from "react"; configure(globalThis as typeof globalThis); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unknown global computed member",
      code: 'import React from "react"; const other = globalThis[loader]("react"); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "direct eval before the initializer",
      code: 'import React from "react"; eval("React.useMemo = expensive"); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a Function constructor capability",
      code: 'import React from "react"; const load = Function("return require(\'react\')")(); configure(load); const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a closed static builtin global member",
      code: 'import React from "react"; const value = globalThis.Math.max(1, 2); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a typeof global object observation",
      code: 'import React from "react"; const present = typeof globalThis; const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a shadowed global object passed as a value",
      code: 'import React from "react"; const configureLocal = (globalThis) => configure(globalThis); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a shadowed Function constructor",
      code: 'import React from "react"; const Function = observe; Function("value"); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "a Function recovered from a global builtin constructor chain",
      code: 'import React from "react"; const other = globalThis.Math.constructor.constructor("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a Function recovered through Reflect.get",
      code: 'import React from "react"; const factory = Reflect.get(() => {}, "constructor"); const other = factory("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a Function recovered by destructuring a constructor",
      code: 'import React from "react"; const { constructor: factory } = () => {}; const other = factory("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an unknown computed destructuring recovery",
      code: 'import React from "react"; const { [property]: factory } = () => {}; const other = factory("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "an Object prototype descriptor recovery",
      code: 'import React from "react"; const factory = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => {}), "constructor").value; const other = factory("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a Function recovered from an array method",
      code: 'import React from "react"; const factory = [].filter.constructor; const other = factory("return process.mainModule.require(\'react\')")(); other.useMemo = expensive; const Component = () => { const reference = React.useRef(React["useMemo"]()); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "a shadowed Reflect object with a nonreflective method",
      code: 'import React from "react"; const Reflect = { observe: observe }; Reflect.observe(value); const Component = () => { const reference = React.useRef(React["useMemo"](() => expensive(), [])); return null; };',
      expectedDiagnostics: 0,
    },
  ])("preserves hook provenance for $name", ({ code, expectedDiagnostics }) => {
    const result = runRule(rerenderLazyRefInit, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
