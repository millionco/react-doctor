import {
  STANDARD_LIBRARY_HOOK_EXCLUSIONS,
  STANDARD_LIBRARY_HOOK_NAMES,
} from "../../constants/standard-library-hooks.js";
import { REACT_BUILTIN_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const STANDARD_HOOK_LIBRARY_SOURCES = ["react-standard-hooks", "react-use", "usehooks-ts"];

const isStandardLibraryHookName = (name: string): boolean =>
  STANDARD_LIBRARY_HOOK_NAMES.has(name) && !STANDARD_LIBRARY_HOOK_EXCLUSIONS.has(name);

// A genuine reimplementation calls a React primitive hook (useState, useEffect,
// …) to build its own behavior; a thin wrapper instead delegates to the
// library hook it imported. We require the former and reject the latter so the
// rule only fires on hand-rolled hooks, never on functions that already use the
// library or on unrelated helpers that merely share a library hook's name.
const functionBodyReimplementsStandardHook = (functionNode: EsTreeNode): boolean => {
  let callsReactBuiltinHook = false;
  let delegatesToStandardLibraryHook = false;
  walkAst(functionNode, (node) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const calleeName = getCalleeName(node);
    if (!calleeName) return;
    if (REACT_BUILTIN_HOOK_NAMES.has(calleeName)) {
      callsReactBuiltinHook = true;
    }
    if (
      STANDARD_HOOK_LIBRARY_SOURCES.some((source) => isImportedFromModule(node, calleeName, source))
    ) {
      delegatesToStandardLibraryHook = true;
    }
  });
  return callsReactBuiltinHook && !delegatesToStandardLibraryHook;
};

const buildMessage = (hookName: string): string =>
  `"${hookName}" reimplements a standard hook — import it from react-standard-hooks (or react-use / usehooks-ts) instead of hand-rolling it`;

export const preferStandardHook = defineRule<Rule>({
  id: "prefer-standard-hook",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Import the hook from react-standard-hooks (or the react-use / usehooks-ts library you already use) instead of reimplementing it — the library version is battle-tested against the edge cases hand-rolled hooks usually miss.",
  create: (context: RuleContext) => {
    const reportIfReimplementedStandardHook = (
      hookName: string,
      functionNode: EsTreeNode,
      reportNode: EsTreeNode,
    ): void => {
      if (!isReactHookName(hookName)) return;
      if (!isStandardLibraryHookName(hookName)) return;
      if (!functionBodyReimplementsStandardHook(functionNode)) return;
      context.report({ node: reportNode, message: buildMessage(hookName) });
    };

    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        const hookName = node.id?.name;
        if (!hookName) return;
        reportIfReimplementedStandardHook(hookName, node, node.id ?? node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        reportIfReimplementedStandardHook(node.id.name, node.init, node.id);
      },
    };
  },
});
