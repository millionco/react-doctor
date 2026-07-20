import { HOOKS_WITH_DEPS } from "../../constants/react.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const REACT_HOOK_NAMES_REQUIRING_EXACT_ALIAS = new Set([
  ...HOOKS_WITH_DEPS,
  "useImperativeHandle",
  "useEffectEvent",
]);

const callForCalleeReference = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const callee = findTransparentExpressionRoot(identifier);
  const parent = callee.parent;
  return parent && isNodeOfType(parent, "CallExpression") && parent.callee === callee
    ? parent
    : null;
};

const isImportedHookName = (
  importedName: string,
  declaration: EsTreeNodeOfType<"ImportDeclaration">,
): boolean => {
  if (importedName !== "use") return isReactHookName(importedName);
  return declaration.source.value === "react";
};

const isProvenHookModule = (declaration: EsTreeNodeOfType<"ImportDeclaration">): boolean =>
  declaration.source.value === "react" || declaration.source.value.startsWith(".");

const isSafeHookWrapperCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const enclosingFunction = findEnclosingFunction(call);
  if (!isFunctionLike(enclosingFunction) || enclosingFunction.async) return false;
  const enclosingFunctionName = componentOrHookDisplayNameForFunction(enclosingFunction);
  if (!enclosingFunctionName || !isReactHookName(enclosingFunctionName)) return false;
  return (
    context.cfg.isUnconditionalFromEntry(call) &&
    !isNodeConditionallyExecuted(call, enclosingFunction) &&
    !isInsideTryStatement(call, { boundary: enclosingFunction })
  );
};

export const hookImportRenameLosesUsePrefix = defineRule({
  id: "hook-import-rename-loses-use-prefix",
  title: "Hook import alias disables hook lint checks",
  severity: "warn",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Keep a recognised `use*` name in custom-hook aliases, reserve bare `use` for React's `use` hook, and do not rename React hooks with name-specific lint semantics such as `useEffect`, `useImperativeHandle`, or `useEffectEvent`.",
  create: (context: RuleContext) => ({
    ImportSpecifier(node: EsTreeNodeOfType<"ImportSpecifier">) {
      if (isNonSourceFilename(context.filename)) return;
      if (node.importKind === "type") return;
      const declaration = node.parent;
      if (
        !declaration ||
        !isNodeOfType(declaration, "ImportDeclaration") ||
        declaration.importKind === "type"
      ) {
        return;
      }

      const importedName = getImportedName(node);
      if (
        !importedName ||
        !isImportedHookName(importedName, declaration) ||
        !isProvenHookModule(declaration)
      ) {
        return;
      }

      const localName = node.local.name;
      if (localName === importedName) return;
      const doesAliasLoseGenericHookSemantics =
        !isReactHookName(localName) || (localName === "use" && importedName !== "use");
      const doesAliasLoseReactHookSpecificSemantics =
        declaration.source.value === "react" &&
        REACT_HOOK_NAMES_REQUIRING_EXACT_ALIAS.has(importedName);
      if (!doesAliasLoseGenericHookSemantics && !doesAliasLoseReactHookSpecificSemantics) return;

      const aliasSymbol = context.scopes.symbolFor(node.local);
      if (!aliasSymbol) return;
      const invokedCalls = aliasSymbol.references.flatMap((reference) => {
        const call = callForCalleeReference(reference.identifier);
        return call ? [call] : [];
      });
      if (invokedCalls.length === 0) return;
      if (
        !doesAliasLoseReactHookSpecificSemantics &&
        invokedCalls.every((call) => isSafeHookWrapperCall(call, context))
      ) {
        return;
      }

      let diagnosticMessage = `Renaming the "${importedName}" hook to "${localName}" turns off Rules of Hooks checks for direct calls, so keep a recognised "use" prefix in the alias.`;
      if (doesAliasLoseReactHookSpecificSemantics) {
        diagnosticMessage = `Renaming React's "${importedName}" hook to "${localName}" prevents hook-specific lint checks from recognising it, so keep the original import name.`;
      } else if (localName === "use") {
        diagnosticMessage = `Renaming the "${importedName}" hook to bare "use" applies React 19's conditionally-callable use() semantics, so keep the hook's original use-prefixed name.`;
      }

      context.report({
        node,
        message: diagnosticMessage,
      });
    },
  }),
});
