import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("ambient Reflect providers", () => {
  it.each([
    ["namespace ambient", "namespace Container { declare function Reflect(): unknown; BODY }", 0],
    [
      "namespace erased ambient",
      "namespace Container { declare function Reflect(): unknown; interface Reflect {} BODY }",
      0,
    ],
    [
      "nested namespace ambient",
      "namespace Container { export namespace Inner { declare function Reflect(): unknown; interface Reflect {} BODY } }",
      0,
    ],
    [
      "dotted namespace ambient",
      "namespace Container.Inner { declare function Reflect(): unknown; interface Reflect {} BODY }",
      0,
    ],
    [
      "outer namespace ambient",
      "namespace Container { declare function Reflect(): unknown; export namespace Inner { BODY } }",
      0,
    ],
    ["native namespace", "namespace Container { BODY }", 1],
    [
      "namespace runtime shadow",
      "namespace Container { const Reflect = { set: () => false }; interface Reflect {} BODY }",
      0,
    ],
    [
      "ambient sibling namespace",
      "namespace Other { declare function Reflect(): unknown; } namespace Container { BODY }",
      1,
    ],
    [
      "native alias behind outer namespace ambient",
      "namespace Container { declare function Reflect(): unknown; export namespace Inner { const Reflect = globalThis.Reflect; BODY } }",
      1,
    ],
    [
      "namespace ambient global object",
      "namespace Container { declare function globalThis(): unknown; const Reflect = globalThis.Reflect; BODY }",
      0,
    ],
  ])("%s", (_, source, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       ${source.replace(
         "BODY",
         'export const Panel = () => { const valueRef = useRef(null); (Reflect as any).set(valueRef, "current", 1); return null; };',
       )}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each([
    ["bare ambient", "declare function Reflect(): unknown;", "", 0],
    [
      "ambient with erased interface",
      "declare function Reflect(): unknown; interface Reflect {}",
      "",
      0,
    ],
    ["inner ambient", "", "declare function Reflect(): unknown;", 0],
    [
      "inner ambient with erased interface",
      "",
      "declare function Reflect(): unknown; interface Reflect {}",
      0,
    ],
    [
      "native alias behind outer ambient",
      "declare function Reflect(): unknown;",
      "const Reflect = globalThis.Reflect;",
      1,
    ],
    [
      "native alias behind outer erased ambient",
      "declare function Reflect(): unknown; interface Reflect {}",
      "const Reflect = globalThis.Reflect;",
      1,
    ],
    [
      "ambient in a sibling function",
      "function other() { declare function Reflect(): unknown; }",
      "",
      1,
    ],
    [
      "native alias behind ambient global object",
      "declare function globalThis(): unknown;",
      "const globalThis = window; const Reflect = globalThis.Reflect;",
      1,
    ],
    [
      "ambient global object alias",
      "declare function globalThis(): unknown; const Reflect = globalThis.Reflect;",
      "",
      0,
    ],
    [
      "erased ambient global object alias",
      "declare function globalThis(): unknown; interface globalThis {} const Reflect = globalThis.Reflect;",
      "",
      0,
    ],
  ])("%s", (_, declaration, setup, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       ${declaration}
       const Panel = () => {
         const valueRef = useRef(null);
         ${setup}
         (Reflect as any).set(valueRef, "current", 1);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("merged namespace and global providers", () => {
  it.each([
    [
      "merged exported runtime alias",
      "declare namespace Container { const provider: unknown; } declare namespace Container { export { provider as Reflect }; } namespace Container { BODY }",
      0,
    ],
    [
      "reopened ambient namespace",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container { BODY }",
      0,
    ],
    [
      "reopened runtime namespace",
      "namespace Container { export const Reflect = { set: () => false }; } namespace Container { BODY }",
      0,
    ],
    [
      "reopened ambient class",
      "namespace Container { export declare class Reflect {} } namespace Container { BODY }",
      0,
    ],
    [
      "reopened runtime class",
      "namespace Container { export class Reflect {} } namespace Container { BODY }",
      0,
    ],
    [
      "unexported sibling namespace",
      "namespace Container { declare function Reflect(): unknown; } namespace Container { BODY }",
      1,
    ],
    [
      "erased merged namespace",
      "namespace Container { export interface Reflect {} } namespace Container { BODY }",
      1,
    ],
    ["native merged namespace", "namespace Container { BODY }", 1],
    [
      "native alias inside merged namespace",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container { const Reflect = globalThis.Reflect; BODY }",
      1,
    ],
    ["global ambient function", "declare global { function Reflect(): unknown; } BODY", 0],
    ["global ambient const", "declare global { const Reflect: unknown; } BODY", 0],
    ["global ambient class", "declare global { class Reflect {} } BODY", 0],
    ["erased global interface", "declare global { interface Reflect {} } BODY", 1],
    [
      "global native member alias",
      "declare global { function Reflect(): unknown; } const nativeReflect = globalThis.Reflect; BODY",
      0,
    ],
    [
      "global native destructuring alias",
      "declare global { function Reflect(): unknown; } const { Reflect: nativeReflect } = globalThis; BODY",
      0,
    ],
  ])("%s", (_, source, diagnosticCount) => {
    const reflectName = source.includes("nativeReflect") ? "nativeReflect" : "Reflect";
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react"; ${source.replace("BODY", `export const Panel = () => { const valueRef = useRef(null); (${reflectName} as any).set(valueRef, "current", 1); return null; };`)}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("native controls beside merged providers", () => {
  it.each([
    [
      "outside a custom namespace",
      "namespace Container { export const Reflect = { set: () => false }; }",
      'Reflect.set(valueRef, "current", 1);',
    ],
    [
      "unrelated native namespace",
      "declare global { function Reflect(): unknown; }",
      "Object.assign(valueRef, { current: 1 });",
    ],
  ])("%s", (_, declaration, write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react"; ${declaration} export const Panel = () => { const valueRef = useRef(null); ${write} return null; };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("Reflect runtime binding regression", () => {
  it.each([
    ["bare native", "", 'Reflect.set(valueRef, "current", value)', 1],
    ["erased interface", "interface Reflect {}", 'Reflect.set(valueRef, "current", value)', 1],
    ["erased type alias", "type Reflect = unknown;", 'Reflect.set(valueRef, "current", value)', 1],
    [
      "erased named import",
      'import type { Reflect } from "./types";',
      'Reflect.set(valueRef, "current", value)',
      1,
    ],
    [
      "erased namespace import",
      'import type * as Reflect from "./types";',
      'Reflect.set(valueRef, "current", value)',
      1,
    ],
    [
      "mixed inline type import",
      'import { type Reflect, runtimeValue } from "./types";',
      'Reflect.set(valueRef, "current", value)',
      1,
    ],
    [
      "native const alias with erased declaration",
      "const Reflect = globalThis.Reflect; interface Reflect {}",
      'Reflect.set(valueRef, "current", value)',
      1,
    ],
    [
      "outer runtime value behind erased declaration",
      "const Reflect = { set: () => false };",
      '(() => { interface Reflect {} Reflect.set(valueRef, "current", value); })()',
      0,
    ],
    [
      "runtime parameter behind erased declaration",
      "",
      '((Reflect) => { interface Reflect {} Reflect.set(valueRef, "current", value); })(customReflect)',
      0,
    ],
    [
      "runtime class behind erased declaration",
      "class Reflect { static set() { return false; } }",
      '(() => { interface Reflect {} Reflect.set(valueRef, "current", value); })()',
      0,
    ],
    [
      "runtime import behind erased declaration",
      'import { Reflect } from "./custom-reflect";',
      '(() => { interface Reflect {} Reflect.set(valueRef, "current", value); })()',
      0,
    ],
    [
      "same-scope runtime and erased declaration",
      "const Reflect = { set: () => false }; interface Reflect {}",
      'Reflect.set(valueRef, "current", value)',
      0,
    ],
    [
      "mutation behind erased declaration",
      "interface Reflect {}",
      'Reflect.set = () => false; Reflect.set(valueRef, "current", value)',
      0,
    ],
    ["direct write control", "interface Reflect {}", "valueRef.current = value", 1],
    [
      "runtime shadow control",
      "const Reflect = { set: () => false };",
      'Reflect.set(valueRef, "current", value)',
      0,
    ],
  ])("%s", (_, declaration, write, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       ${declaration}
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });
});

describe("ref writes through Reflect.set during render", () => {
  it.each([
    "valueRef.current = value",
    'Reflect.set(valueRef, "current", value)',
    'Reflect["set"](valueRef, "current", value)',
    "Reflect[`set`](valueRef, `current`, value)",
    'Reflect.set?.(valueRef, "current", value)',
    '((Reflect as typeof Reflect).set)(valueRef!, ("current" as const), value)',
    'Reflect.set(alias, "current", value)',
    'Reflect.set(valueRef, "current", value, valueRef)',
    'Reflect.set(valueRef, "current", value, alias)',
    'Reflect.set(alias, "current", value, valueRef!)',
    'Reflect.set(valueRef, "current", value, otherRef)',
    'Reflect.set(alias, "current", value, receiverAlias)',
    'Reflect.set(valueRef, "current", value, otherRef!)',
    'Reflect.set({ current: null }, "current", value, valueRef)',
    'Reflect.set({ ["current"]: null }, "current", value, valueRef)',
    'Reflect.set({ __proto__: null }, "current", value, valueRef)',
    'Reflect.set(({ __proto__: null } as object), "current", value, valueRef!)',
    '(() => Reflect.set(valueRef, "current", value))()',
    '[value].forEach((entry) => Reflect.set(valueRef, "current", entry))',
    'Reflect.set(Reflect, "metadata", value); Reflect.set(valueRef, "current", value)',
  ])("reports %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         const alias = valueRef;
         const otherRef = useRef(null);
         const receiverAlias = otherRef;
         ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ['import { useRef as makeRef } from "react";', "makeRef(null)"],
    ['import * as React from "react";', "React.useRef(null)"],
  ])("uses proven React provenance: %s", (imports, initializer) => {
    const result = runRule(
      noRefCurrentInRender,
      `${imports}
       const useLatest = (value) => {
         const valueRef = ${initializer};
         Reflect.set(valueRef, "current", value);
         return valueRef;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'const Reflect = { set() {} }; Reflect.set(valueRef, "current", value);',
    '((Reflect) => Reflect.set(valueRef, "current", value))(customReflect);',
    'Reflect.set = () => false; Reflect.set(valueRef, "current", value);',
    'Object.defineProperty(Reflect, "set", { value: () => false }); Reflect.set(valueRef, "current", value);',
    'Object.assign(Reflect, { set: () => false }); Reflect.set(valueRef, "current", value);',
    'replaceReflect(Reflect); Reflect.set(valueRef, "current", value);',
    'const provider = Reflect; replaceReflect(provider); Reflect.set(valueRef, "current", value);',
    'Reflect.set(Reflect, "set", () => false); Reflect.set(valueRef, "current", value);',
    'replaceMethod(Reflect.set); Reflect.set(valueRef, "current", value);',
    'Reflect = customReflect; Reflect.set(valueRef, "current", value);',
    'Reflect.set({}, "set", () => false, Reflect); Reflect.set(valueRef, "current", value);',
    'Object.defineProperty(globalThis, "Reflect", { value: customReflect }); Reflect.set(valueRef, "current", value);',
    'const record = { current: null }; Reflect.set(record, "current", value);',
    'const valueRef = { current: null }; Reflect.set(valueRef, "current", value);',
    'Reflect.set(valueRef, "value", value);',
    "Reflect.set(valueRef, propertyName, value);",
    'Reflect[methodName](valueRef, "current", value);',
    'Reflect.set(valueRef.current, "current", value);',
    'Reflect.set({ ...valueRef }, "current", value);',
    'Reflect.set(valueRef, "current", value, {});',
    'Reflect.set(valueRef, "current", value, unknownReceiver);',
    'Reflect.set(valueRef, "current", value, undefined);',
    'const alias = valueRef; { const valueRef = {}; Reflect.set(alias, "current", value, valueRef); }',
    'Reflect.set({ set current(value) {} }, "current", value, valueRef);',
    'Reflect.set({ get current() { return null; } }, "current", value, valueRef);',
    'Reflect.set({ current: null, ...unknown }, "current", value, valueRef);',
    'Reflect.set({ current: null, [propertyName]: null }, "current", value, valueRef);',
    'Reflect.set({ ["__proto__"]: null }, "current", value, valueRef);',
    'Reflect.set({ __proto__() {} }, "current", value, valueRef);',
    'Reflect.set({ __proto__ }, "current", value, valueRef);',
    "Reflect.set(valueRef, ...argumentsList);",
    'Reflect.set(...argumentsList, "current", value);',
    'const set = Reflect.set; set(valueRef, "current", value);',
  ])("keeps unproven target writes quiet: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         { ${statement} }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["{}", "unknownTarget"])(
    "leaves writes through unsupported non-ref target %s outside detection",
    (target) => {
      const result = runRule(
        noRefCurrentInRender,
        `import { useRef } from "react";
         const Panel = ({ value }) => {
           const valueRef = useRef(null);
           Reflect.set(${target}, "current", value, valueRef);
           return null;
         };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    ["receiverRef.current", 0],
    ["receiverAlias.current", 0],
    ["targetRef.current", 1],
  ])("checks initialization against destination %s", (guardedMember, diagnosticCount) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const targetRef = useRef(null);
         const receiverRef = useRef(null);
         const receiverAlias = receiverRef;
         if (${guardedMember} === null) {
           Reflect.set(targetRef, "current", new Map(), receiverRef);
         }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it.each(["{ current: null }", "{ __proto__: null }"])(
    "preserves receiver initialization with known literal target %s",
    (target) => {
      const result = runRule(
        noRefCurrentInRender,
        `import { useRef } from "react";
         const Panel = () => {
           const receiverRef = useRef(null);
           if (receiverRef.current === null) {
             Reflect.set(${target}, "current", new Map(), receiverRef);
           }
           return null;
         };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("detects competing writes to the effective receiver", () => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const targetRef = useRef(null);
         const receiverRef = useRef(null);
         if (receiverRef.current === null) {
           Reflect.set(targetRef, "current", new Map(), receiverRef);
           receiverRef.current = null;
         }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps userland useRef lookalikes quiet", () => {
    const result = runRule(
      noRefCurrentInRender,
      `const useRef = (current) => ({ current });
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         Reflect.set(valueRef, "current", value);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'useEffect(() => { Reflect.set(valueRef, "current", value); }, [value]);',
    'queueMicrotask(() => Reflect.set(valueRef, "current", value));',
    'const onClick = () => Reflect.set(valueRef, "current", value);',
  ])("preserves deferred writes: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useEffect, useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${statement}
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'Reflect.set(valueRef, "current", new Map())',
    'Reflect.set(alias, "current", new Map())',
    'Reflect.set(valueRef, "current", new Map(), valueRef)',
    'Reflect.set(valueRef, "current", new Map(), alias)',
    'void Reflect.set(valueRef, "current", new Map())',
  ])("preserves predictable guarded initialization: %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         const alias = valueRef;
         if (valueRef.current === null) ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'Reflect.set(valueRef, "current", value)',
    'Reflect.set(valueRef, "current", Math.random())',
    'Reflect.set(valueRef, "current", new Map(), valueRef, reset(valueRef))',
  ])("keeps unsafe guarded writes visible: %s", (write) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         if (valueRef.current === null) ${write};
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'const didInitialize = Reflect.set(valueRef, "current", new Map());',
    'publishStatus(Reflect.set(valueRef, "current", new Map()));',
    'return Reflect.set(valueRef, "current", new Map(), valueRef);',
  ])("permits consuming the boolean initialization result: %s", (statement) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) { ${statement} }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["useMemo", "useState"])("reports render-phase %s callbacks", (hookName) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { ${hookName}, useRef } from "react";
       const Panel = ({ value }) => {
         const valueRef = useRef(null);
         ${hookName}(() => Reflect.set(valueRef, "current", value), []);
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'valueRef.current = new Map(); Reflect.set(valueRef, "current", null);',
    'Reflect.set(valueRef, "current", new Map()); valueRef.current = null;',
    'Object.assign(valueRef, { current: new Map() }); Reflect.set(valueRef, "current", null);',
  ])("rejects competing resets: %s", (statements) => {
    const result = runRule(
      noRefCurrentInRender,
      `import { useRef } from "react";
       const Panel = () => {
         const valueRef = useRef(null);
         if (valueRef.current === null) { ${statements} }
         return null;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
