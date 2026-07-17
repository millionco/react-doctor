import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

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

const isSafeHookWrapperCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const enclosingFunction = findEnclosingFunction(call);
  if (!enclosingFunction) return false;
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
  title: "Hook import alias drops the use prefix",
  severity: "warn",
  category: "Bugs",
  tags: ["test-noise"],
  recommendation:
    "Keep the `use` prefix in the alias (e.g. `useQuery as useProducts`) or import the hook without renaming. Hook linting recognises hooks only by their `use` name at the call site, so dropping the prefix silently turns off rules-of-hooks and exhaustive-deps for it.",
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
      if (!importedName || !isImportedHookName(importedName, declaration)) return;

      const localName = node.local.name;
      if (localName === importedName || isReactHookName(localName)) return;

      const aliasSymbol = context.scopes.symbolFor(node.local);
      if (!aliasSymbol) return;
      const invokedCalls = aliasSymbol.references.flatMap((reference) => {
        const call = callForCalleeReference(reference.identifier);
        return call ? [call] : [];
      });
      if (invokedCalls.length === 0) return;
      if (invokedCalls.every((call) => isSafeHookWrapperCall(call, context))) {
        return;
      }

      context.report({
        node,
        message: `Renaming the "${importedName}" hook to "${localName}" turns off rules-of-hooks and exhaustive-deps for every call of it, so keep the "use" prefix in the alias.`,
      });
    },
  }),
});
