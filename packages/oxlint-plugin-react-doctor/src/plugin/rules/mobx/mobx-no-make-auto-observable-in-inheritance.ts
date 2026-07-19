import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getClassBindingSymbol } from "../../utils/get-class-binding-symbol.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { MOBX_RULE_GATES } from "../../utils/mobx-rule-gates.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "MobX does not support `makeAutoObservable(this)` in inherited classes. Use composition or explicit `makeObservable` annotations.";

const getEnclosingConstructorClass = (
  node: EsTreeNode,
): EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression"> | null => {
  let ancestor = node.parent;
  while (ancestor) {
    if (!isFunctionLike(ancestor)) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    const methodDefinition = ancestor.parent;
    if (
      !isNodeOfType(methodDefinition, "MethodDefinition") ||
      methodDefinition.kind !== "constructor"
    ) {
      return null;
    }
    const classNode = methodDefinition.parent?.parent;
    return isNodeOfType(classNode, "ClassDeclaration") || isNodeOfType(classNode, "ClassExpression")
      ? classNode
      : null;
  }
  return null;
};

const isNonNullSuperclass = (
  classNode: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">,
): boolean => {
  if (!classNode.superClass) return false;
  const superClass = stripParenExpression(classNode.superClass);
  return !(isNodeOfType(superClass, "Literal") && superClass.value === null);
};

const subclassedClassSymbolIdsByAnalysis = new WeakMap<ScopeAnalysis, ReadonlySet<number>>();

const getSubclassedClassSymbolIds = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<number> => {
  const cached = subclassedClassSymbolIdsByAnalysis.get(scopes);
  if (cached) return cached;
  const symbolIds = new Set<number>();
  const program = findProgramRoot(node);
  if (program) {
    walkAst(program, (candidate) => {
      if (
        (!isNodeOfType(candidate, "ClassDeclaration") &&
          !isNodeOfType(candidate, "ClassExpression")) ||
        !isNonNullSuperclass(candidate)
      ) {
        return;
      }
      const superClassExpression = candidate.superClass;
      if (!superClassExpression) return;
      const superClass = stripParenExpression(superClassExpression);
      if (!isNodeOfType(superClass, "Identifier")) return;
      const symbol = resolveConstIdentifierAlias(superClass, scopes);
      if (
        symbol?.kind === "class" ||
        (symbol?.kind === "const" && isNodeOfType(symbol.initializer, "ClassExpression"))
      ) {
        symbolIds.add(symbol.id);
      }
    });
  }
  subclassedClassSymbolIdsByAnalysis.set(scopes, symbolIds);
  return symbolIds;
};

const isMakeAutoObservableCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const reference = resolveImportedApiReference(callExpression.callee, scopes);
  return reference?.source === "mobx" && reference.importedName === "makeAutoObservable";
};

export const mobxNoMakeAutoObservableInInheritance = defineRule({
  id: "mobx-no-make-auto-observable-in-inheritance",
  title: "Unsupported MobX auto-observable inheritance",
  severity: "error",
  category: "Bugs",
  requires: MOBX_RULE_GATES["mobx-no-make-auto-observable-in-inheritance"].requires,
  recommendation:
    "Replace inheritance with composition, or annotate inherited members explicitly with `makeObservable`.",
  create: (context: RuleContext) => ({
    CallExpression(callExpression: EsTreeNodeOfType<"CallExpression">) {
      if (!isMakeAutoObservableCall(callExpression, context.scopes)) return;
      const target = callExpression.arguments[0];
      if (!target || !isNodeOfType(stripParenExpression(target), "ThisExpression")) return;
      const classNode = getEnclosingConstructorClass(callExpression);
      if (!classNode) return;
      const classSymbol = getClassBindingSymbol(classNode, context.scopes);
      const isSubclassed = Boolean(
        classSymbol &&
        getSubclassedClassSymbolIds(callExpression, context.scopes).has(classSymbol.id),
      );
      if (!isNonNullSuperclass(classNode) && !isSubclassed) return;
      context.report({ node: callExpression, message: MESSAGE });
    },
  }),
});
