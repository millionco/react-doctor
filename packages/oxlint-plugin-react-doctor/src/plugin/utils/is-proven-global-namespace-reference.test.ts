import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import * as valueImportHelpers from "./get-value-import-declaration.js";
import * as namespaceValueHelpers from "./get-namespace-value-provider.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

describe("native namespace runtime bindings", () => {
  it.each([
    ["native global", "Reflect;", [[true, true]]],
    ["interface", "interface Reflect {} Reflect;", [[true, true]]],
    ["type alias", "type Reflect = unknown; Reflect;", [[true, true]]],
    ["ambient function", "declare function Reflect(): unknown; Reflect;", [[false, false]]],
    [
      "namespace ambient function",
      "namespace Container { declare function Reflect(): unknown; interface Reflect {} Reflect; }",
      [[false, false]],
    ],
    [
      "nested namespace ambient function",
      "namespace Container { namespace Inner { declare function Reflect(): unknown; interface Reflect {} Reflect; } }",
      [[false, false]],
    ],
    [
      "dotted namespace ambient function",
      "namespace Container.Inner { declare function Reflect(): unknown; interface Reflect {} Reflect; }",
      [[false, false]],
    ],
    [
      "ambient function with erased interface",
      "declare function Reflect(): unknown; interface Reflect {} Reflect;",
      [[false, false]],
    ],
    [
      "inner ambient function",
      "function inspect() { declare function Reflect(): unknown; Reflect; }",
      [[false, false]],
    ],
    [
      "outer ambient function",
      "function outer() { declare function Reflect(): unknown; const inner = () => { Reflect; }; }",
      [[false, false]],
    ],
    [
      "exported ambient function",
      "export declare function Reflect(): unknown; interface Reflect {} Reflect;",
      [[false, false]],
    ],
    [
      "ambient declaration in sibling scope",
      "function other() { declare function Reflect(): unknown; } Reflect;",
      [[true, true]],
    ],
    [
      "native alias inside ambient provider scope",
      "declare function Reflect(): unknown; function inspect() { const Reflect = globalThis.Reflect; Reflect; }",
      [[true, true]],
    ],
    ["type import", 'import type { Reflect } from "./types"; Reflect;', [[true, true]]],
    ["default type import", 'import type Reflect from "./types"; Reflect;', [[true, true]]],
    ["import equals type", 'import type Reflect = require("./types"); Reflect;', [[true, true]]],
    ["namespace type import", 'import type * as Reflect from "./types"; Reflect;', [[true, true]]],
    [
      "mixed inline type import",
      'import { type Reflect, value } from "./types"; Reflect;',
      [[true, true]],
    ],
    [
      "all inline type imports",
      'import { type Other, type Reflect } from "./types"; Reflect;',
      [[true, true]],
    ],
    [
      "same-scope runtime value",
      "const Reflect = {}; interface Reflect {} Reflect;",
      [[false, false]],
    ],
    [
      "same-scope later runtime value",
      "interface Reflect {} const Reflect = {}; Reflect;",
      [[false, false]],
    ],
    [
      "outer runtime value",
      "const Reflect = {}; function inspect() { interface Reflect {} Reflect; }",
      [[false, false]],
    ],
    [
      "outer runtime parameter",
      "function inspect(Reflect) { const read = () => { interface Reflect {} Reflect; }; }",
      [[false, false]],
    ],
    [
      "outer runtime class",
      "class Reflect {} function inspect() { interface Reflect {} Reflect; }",
      [[false, false]],
    ],
    [
      "outer runtime import",
      'import { Reflect } from "./custom"; function inspect() { interface Reflect {} Reflect; }',
      [[false, false]],
    ],
    [
      "value specifier in mixed import",
      'import { type Other, Reflect } from "./custom"; interface Reflect {} Reflect;',
      [[false, false]],
    ],
    [
      "runtime namespace",
      "namespace Reflect { export const marker = 1; } interface Reflect {} Reflect;",
      [[false, false]],
    ],
    [
      "ambient value",
      "declare const Reflect: unknown; interface Reflect {} Reflect;",
      [[false, false]],
    ],
    [
      "native alias",
      "const nativeReflect = globalThis.Reflect; const Reflect = nativeReflect; interface Reflect {} Reflect;",
      [[true, true]],
    ],
    [
      "sibling runtime scope restoration",
      "interface Reflect {} { const Reflect = {}; Reflect; } { Reflect; }",
      [
        [false, false],
        [true, true],
      ],
    ],
    [
      "native member mutation",
      "interface Reflect {} Reflect.set = customSet; Reflect;",
      [[true, false]],
    ],
    [
      "native namespace escape",
      "interface Reflect {} replaceProvider(Reflect); Reflect;",
      [[true, false]],
    ],
  ])("%s", (_, source, expectedProofs) => {
    const parsed = parseFixture(source);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const proofs: boolean[][] = [];
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "ExpressionStatement")) return;
      const expression = node.expression;
      if (!isNodeOfType(expression, "Identifier") || expression.name !== "Reflect") return;
      proofs.push([
        isProvenGlobalNamespaceReference(expression, "Reflect", scopes),
        isProvenUnmodifiedGlobalNamespaceReference(expression, "Reflect", scopes, "set", true),
      ]);
    });
    expect(proofs).toEqual(expectedProofs);
  });

  it("recovers a global-object reference behind an erased declaration", () => {
    const parsed = parseFixture("interface globalThis {} globalThis;");
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "ExpressionStatement")) return;
      expect(isProvenGlobalObjectReference(node.expression, scopes)).toBe(true);
    });
  });

  it("classifies each import declaration group once per analysis", () => {
    const parsed = parseFixture(`
      import { type Reflect, type Other, runtimeValue } from "./types";
      Reflect;
      Reflect;
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const valueImportSpy = vi.spyOn(valueImportHelpers, "getValueImportDeclaration");
    try {
      walkAst(parsed.program, (node) => {
        if (!isNodeOfType(node, "ExpressionStatement")) return;
        expect(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes)).toBe(true);
        expect(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes)).toBe(true);
      });
      expect(valueImportSpy).toHaveBeenCalledTimes(2);
    } finally {
      valueImportSpy.mockRestore();
    }
  });

  it.each(["globalThis", "window", "self", "global"])(
    "refuses the ambient global-object provider %s",
    (name) => {
      const parsed = parseFixture(
        `declare function ${name}(): unknown; interface ${name} {} ${name};`,
      );
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      walkAst(parsed.program, (node) => {
        if (!isNodeOfType(node, "ExpressionStatement")) return;
        expect(isProvenGlobalObjectReference(node.expression, scopes)).toBe(false);
      });
    },
  );

  it("retains a native global-object alias inside an outer ambient declaration", () => {
    const parsed = parseFixture(`
      declare function globalThis(): unknown;
      function inspect() { const globalThis = window; globalThis; }
    `);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "ExpressionStatement")) return;
      expect(isProvenGlobalObjectReference(node.expression, scopes)).toBe(true);
    });
  });

  it("memoizes ambient visibility for repeated native proofs in one scope", () => {
    const parsed = parseFixture("Reflect; Reflect;");
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const provider = namespaceValueHelpers.getNamespaceValueProvider(scopes.rootScope, "Reflect");
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "ExpressionStatement")) return;
      expect(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes)).toBe(true);
      expect(
        namespaceValueHelpers.getNamespaceValueProvider(scopes.scopeFor(node), "Reflect"),
      ).toBe(provider);
    });
  });
});

describe("ambient value visibility", () => {
  it.each([
    [
      "qualified runtime namespace",
      "namespace Reflect.Inner { export const custom = true; } Reflect;",
      false,
    ],
    [
      "qualified namespace member",
      "namespace Container.Reflect { export const marker = 1; } namespace Container { Reflect; }",
      false,
    ],
    [
      "qualified deep namespace member",
      "namespace Container.Reflect.Inner { export const marker = 1; } namespace Container { Reflect; }",
      false,
    ],
    [
      "qualified namespace self",
      "namespace Container.Reflect { export const marker = 1; Reflect; }",
      false,
    ],
    [
      "merged provider before outer native alias",
      "const Reflect = globalThis.Reflect; namespace Container { export const Reflect = custom; } namespace Container { Reflect; }",
      false,
    ],
    [
      "merged ambient before outer native alias",
      "const Reflect = globalThis.Reflect; namespace Container { export declare function Reflect(): unknown; } namespace Container { Reflect; }",
      false,
    ],
    [
      "arbitrary merged alias shadow",
      "const nativeReflect = globalThis.Reflect; namespace Container { export const nativeReflect = custom; } namespace Container { nativeReflect; }",
      false,
    ],
    [
      "merged global object before outer native alias",
      "const globalThis = window; namespace Container { export const globalThis = custom; } namespace Container { globalThis.Reflect; }",
      false,
    ],
    [
      "explicit local alias before merged provider",
      "const Reflect = globalThis.Reflect; namespace Container { export const Reflect = custom; } namespace Container { const Reflect = globalThis.Reflect; Reflect; }",
      true,
    ],
    [
      "ambient lexical before outer native alias",
      "const Reflect = globalThis.Reflect; function inspect() { declare function Reflect(): unknown; Reflect; }",
      false,
    ],
    [
      "unexported ambient import",
      "declare namespace Custom { const marker: number; } declare namespace Container { import Reflect = Custom; } namespace Container { Reflect; }",
      true,
    ],
    [
      "exported ambient import",
      "declare namespace Custom { const marker: number; } declare namespace Container { export import Reflect = Custom; } namespace Container { Reflect; }",
      false,
    ],
    [
      "ambient explicit empty export with namespace",
      "declare namespace Container { namespace Reflect { const marker: number; } export {}; } namespace Container { Reflect; }",
      true,
    ],
    [
      "ambient explicit cross-fragment value export",
      "declare namespace Container { const provider: unknown; } declare namespace Container { export { provider as Reflect }; } namespace Container { Reflect; }",
      false,
    ],
    [
      "ambient explicit cross-fragment interface export",
      "declare namespace Container { interface Provider {} } declare namespace Container { export { Provider as Reflect }; } namespace Container { Reflect; }",
      true,
    ],
    [
      "ambient explicit alias chain",
      "declare namespace Container { const provider: unknown; } declare namespace Container { export { provider as middle, middle as Reflect }; } namespace Container { Reflect; }",
      false,
    ],
    [
      "ambient explicit empty export",
      "declare namespace Container { function Reflect(): unknown; export {}; } namespace Container { Reflect; }",
      true,
    ],
    [
      "ambient explicit value alias export",
      "declare namespace Container { const provider: unknown; export { provider as Reflect }; } namespace Container { Reflect; }",
      false,
    ],
    [
      "ambient explicit interface alias export",
      "declare namespace Container { interface Provider {} export { Provider as Reflect }; } namespace Container { Reflect; }",
      true,
    ],
    [
      "ambient explicit type alias export",
      "declare namespace Container { type Provider = unknown; export type { Provider as Reflect }; } namespace Container { Reflect; }",
      true,
    ],
    [
      "reopened namespace",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container { Reflect; }",
      false,
    ],
    [
      "later namespace declaration",
      "namespace Container { Reflect; } namespace Container { export declare function Reflect(): unknown; }",
      false,
    ],
    [
      "ambient namespace",
      "declare namespace Container { function Reflect(): unknown; } namespace Container { Reflect; }",
      false,
    ],
    [
      "reopened nested namespace",
      "namespace Container { export namespace Inner { export declare function Reflect(): unknown; } } namespace Container { export namespace Inner { Reflect; } }",
      false,
    ],
    [
      "reopened dotted namespace",
      "namespace Container.Inner { export declare function Reflect(): unknown; } namespace Container.Inner { Reflect; }",
      false,
    ],
    [
      "outer merged namespace",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container.Inner { Reflect; }",
      false,
    ],
    [
      "unexported namespace declaration",
      "namespace Container { declare function Reflect(): unknown; } namespace Container { Reflect; }",
      true,
    ],
    [
      "unexported nested namespaces",
      "namespace Container { namespace Inner { export declare function Reflect(): unknown; } } namespace Container { namespace Inner { Reflect; } }",
      true,
    ],
    [
      "sibling namespace",
      "namespace Other { export declare function Reflect(): unknown; } namespace Container { Reflect; }",
      true,
    ],
    [
      "sibling lexical scope",
      "function outer() { namespace Container { export declare function Reflect(): unknown; } } function inspect() { namespace Container { Reflect; } }",
      true,
    ],
    [
      "sibling external module",
      'declare module "other" { function Reflect(): unknown; } declare module "container" { Reflect; }',
      true,
    ],
    [
      "reopened external module",
      'declare module "container" { function Reflect(): unknown; } declare module "container" { Reflect; }',
      false,
    ],
    [
      "unrelated external module",
      'declare module "container" { function Reflect(): unknown; } Reflect;',
      true,
    ],
    [
      "erased merged interface",
      "namespace Container { export interface Reflect {} } namespace Container { Reflect; }",
      true,
    ],
    [
      "erased merged import",
      'declare module "container" { import type { Reflect } from "./types"; } declare module "container" { Reflect; }',
      true,
    ],
    [
      "erased merged type",
      "namespace Container { export type Reflect = unknown; } namespace Container { Reflect; }",
      true,
    ],
    [
      "native alias in reopened namespace",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container { const Reflect = globalThis.Reflect; Reflect; }",
      true,
    ],
    [
      "native alias behind merged erased declaration",
      "namespace Container { export declare function Reflect(): unknown; } namespace Container { const Reflect = globalThis.Reflect; interface Reflect {} Reflect; }",
      true,
    ],
    [
      "global augmentation",
      "export {}; declare global { function Reflect(): unknown; } Reflect;",
      false,
    ],
    [
      "later global augmentation",
      "export {}; Reflect; declare global { function Reflect(): unknown; }",
      false,
    ],
    [
      "erased global interface",
      "export {}; declare global { interface Reflect {} } Reflect;",
      true,
    ],
    [
      "global member provider",
      "export {}; declare global { function Reflect(): unknown; } globalThis.Reflect;",
      false,
    ],
    [
      "global alias provider",
      "export {}; declare global { function Reflect(): unknown; } const nativeReflect = globalThis.Reflect; nativeReflect;",
      false,
    ],
    [
      "destructured global provider",
      "export {}; declare global { function Reflect(): unknown; } const { Reflect: nativeReflect } = globalThis; nativeReflect;",
      false,
    ],
    [
      "global namespace differs from local namespace",
      "export {}; declare global { namespace Container { function Reflect(): unknown; } } namespace Container { Reflect; }",
      true,
    ],
  ])("%s", (_, source, expectedProof) => {
    const parsed = parseFixture(source);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const proofs: boolean[] = [];
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "ExpressionStatement")) return;
      proofs.push(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes));
    });
    expect(proofs).toEqual([expectedProof]);
  });

  it.each(["Reflect", "Object", "Math"])("rejects merged ambient values for %s", (name) => {
    for (const declaration of [
      `function ${name}(): unknown;`,
      `const ${name}: unknown;`,
      `var ${name}: unknown;`,
      `class ${name} {}`,
      `enum ${name} { Custom }`,
      `namespace ${name} {}`,
    ]) {
      for (const source of [
        `namespace Container { export declare ${declaration} } namespace Container { ${name}; }`,
        `declare namespace Container { ${declaration} } namespace Container { ${name}; }`,
        `export {}; declare global { ${declaration} } ${name};`,
      ]) {
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        walkAst(parsed.program, (node) => {
          if (!isNodeOfType(node, "ExpressionStatement")) return;
          expect(isProvenGlobalNamespaceReference(node.expression, name, scopes)).toBe(false);
        });
      }
    }
  });

  it.each(["Reflect", "Object", "Math"])(
    "rejects ordinary merged runtime values for %s",
    (name) => {
      for (const declaration of [
        `const ${name} = {};`,
        `let ${name} = {};`,
        `var ${name} = {};`,
        `class ${name} {}`,
        `function ${name}() {}`,
        `enum ${name} { Custom }`,
        `namespace ${name} { export const custom = true; }`,
      ]) {
        const parsed = parseFixture(
          `namespace Container { export ${declaration} } namespace Container { ${name}; }`,
        );
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        walkAst(parsed.program, (node) => {
          if (!isNodeOfType(node, "ExpressionStatement")) return;
          expect(isProvenGlobalNamespaceReference(node.expression, name, scopes)).toBe(false);
        });
      }
    },
  );

  it.each(["globalThis", "window", "self", "global"])(
    "distinguishes erased and runtime global augmentations for %s",
    (name) => {
      for (const hasRuntimeProvider of [false, true]) {
        const source = `export {}; declare global { ${hasRuntimeProvider ? `function ${name}(): unknown;` : `interface ${name} {}`} } ${name};`;
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        walkAst(parsed.program, (node) => {
          if (!isNodeOfType(node, "ExpressionStatement")) return;
          expect(isProvenGlobalObjectReference(node.expression, scopes)).toBe(!hasRuntimeProvider);
        });
      }
    },
  );
});
