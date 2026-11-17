import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { closureCaptures } from "../semantic/closure-captures.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "./attach-parent-references.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findLiteralIndexDependencyCoverage } from "./find-literal-index-dependency-coverage.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface LiteralIndexHookNodes {
  callback: EsTreeNode;
  dependencies: EsTreeNodeOfType<"ArrayExpression">;
}

describe("literal index dependency coverage work", () => {
  it.each([16, 32, 64, 128])(
    "bounds capture and dependency reads linearly for %s roots",
    (rootCount) => {
      const names = Array.from(
        { length: rootCount },
        (_unused, rootIndex) => `entries${rootIndex}`,
      );
      const slots = names.map((name) => `${name}[0]`).join(", ");
      const parsed = parseFixture(
        `const Example = ({ ${names.join(", ")} }) => useMemo(() => [${slots}], [${slots}]);`,
      );
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      let callback: EsTreeNode | undefined;
      let dependencies: EsTreeNodeOfType<"ArrayExpression"> | undefined;
      walkAst(parsed.program, (node) => {
        if (!isNodeOfType(node, "CallExpression")) return;
        if (isFunctionLike(node.arguments[0])) callback = node.arguments[0];
        if (isNodeOfType(node.arguments[1], "ArrayExpression")) dependencies = node.arguments[1];
      });
      if (!callback || !dependencies) throw new Error("Missing synthetic Hook nodes");
      const captures = closureCaptures(callback, scopes);
      let captureSymbolReads = 0;
      let dependencyElementReads = 0;
      for (const reference of captures) {
        const symbol = reference.resolvedSymbol;
        Object.defineProperty(reference, "resolvedSymbol", {
          get: () => {
            captureSymbolReads += 1;
            return symbol;
          },
        });
      }
      const elements = dependencies.elements;
      Reflect.set(
        dependencies,
        "elements",
        new Proxy(elements, {
          get: (target, property, receiver) => {
            if (typeof property === "string" && /^\d+$/.test(property)) dependencyElementReads += 1;
            return Reflect.get(target, property, receiver);
          },
        }),
      );
      const coveredRoots = findLiteralIndexDependencyCoverage({
        callback,
        dependencies,
        missingCaptureKeys: names,
        scopes,
      });
      expect([...coveredRoots]).toEqual(names);
      expect(captureSymbolReads).toBeLessThanOrEqual(rootCount * 4);
      expect(dependencyElementReads).toBeLessThanOrEqual(rootCount * 4);
      expect(captureSymbolReads).toBeGreaterThan(0);
      expect(dependencyElementReads).toBeGreaterThan(0);
      const freshScopes = analyzeScopes(parsed.program);
      expect([
        ...findLiteralIndexDependencyCoverage({
          callback,
          dependencies,
          missingCaptureKeys: names,
          scopes: freshScopes,
        }),
      ]).toEqual(names);
    },
  );

  it.each([16, 32, 64, 128])(
    "bounds shared-symbol inventory reads across %s Hooks",
    (hookCount) => {
      for (const hasRootEscape of [false, true]) {
        const parsed = parseFixture(
          `const Example = ({ choices }) => {
           ${"useMemo(() => choices[0], [choices[0]]);".repeat(hookCount)}
           ${hasRootEscape ? "consume(choices);" : ""}
         };`,
        );
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const hooks: LiteralIndexHookNodes[] = [];
        walkAst(parsed.program, (node) => {
          if (
            isNodeOfType(node, "CallExpression") &&
            isFunctionLike(node.arguments[0]) &&
            isNodeOfType(node.arguments[1], "ArrayExpression")
          ) {
            hooks.push({ callback: node.arguments[0], dependencies: node.arguments[1] });
          }
        });
        for (const hook of hooks) closureCaptures(hook.callback, scopes);
        const firstHook = hooks[0];
        if (!firstHook) throw new Error("Missing synthetic Hook nodes");
        const symbol = closureCaptures(firstHook.callback, scopes)[0]?.resolvedSymbol;
        if (!symbol) throw new Error("Missing synthetic root binding");
        let referenceReads = 0;
        Reflect.set(
          symbol,
          "references",
          new Proxy(symbol.references, {
            get: (target, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property)) referenceReads += 1;
              return Reflect.get(target, property, receiver);
            },
          }),
        );
        let initialInventoryReads: number | undefined;
        for (const hook of hooks) {
          expect(
            findLiteralIndexDependencyCoverage({
              ...hook,
              missingCaptureKeys: ["choices"],
              scopes,
            }).has("choices"),
          ).toBe(!hasRootEscape);
          initialInventoryReads ??= referenceReads;
          expect(referenceReads).toBe(initialInventoryReads);
        }
        expect(referenceReads).toBeGreaterThan(0);
        expect(referenceReads).toBeLessThanOrEqual(symbol.references.length);
      }
    },
  );

  it("does not inspect captures when dependencies have no numeric slots", () => {
    const parsed = parseFixture(
      "const Example = ({ first, second }) => useMemo(() => first + second, []);",
    );
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let callback: EsTreeNode | undefined;
    let dependencies: EsTreeNodeOfType<"ArrayExpression"> | undefined;
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "CallExpression")) return;
      if (isFunctionLike(node.arguments[0])) callback = node.arguments[0];
      if (isNodeOfType(node.arguments[1], "ArrayExpression")) dependencies = node.arguments[1];
    });
    if (!callback || !dependencies) throw new Error("Missing synthetic Hook nodes");
    const captures = closureCaptures(callback, scopes);
    let captureSymbolReads = 0;
    for (const reference of captures) {
      const symbol = reference.resolvedSymbol;
      Object.defineProperty(reference, "resolvedSymbol", {
        get: () => {
          captureSymbolReads += 1;
          return symbol;
        },
      });
    }
    expect(
      findLiteralIndexDependencyCoverage({
        callback,
        dependencies,
        missingCaptureKeys: ["first", "second"],
        scopes,
      }).size,
    ).toBe(0);
    expect(captureSymbolReads).toBe(0);
  });
});
