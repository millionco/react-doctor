import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import * as valueImportHelpers from "./get-value-import-declaration.js";
import * as ambientFunctionHelpers from "./has-visible-ambient-function-declaration.js";
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
    const ambientSpy = vi.spyOn(ambientFunctionHelpers, "hasVisibleAmbientFunctionDeclaration");
    try {
      walkAst(parsed.program, (node) => {
        if (!isNodeOfType(node, "ExpressionStatement")) return;
        expect(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes)).toBe(true);
        expect(isProvenGlobalNamespaceReference(node.expression, "Reflect", scopes)).toBe(true);
      });
      expect(ambientSpy).toHaveBeenCalledTimes(1);
    } finally {
      ambientSpy.mockRestore();
    }
  });
});
