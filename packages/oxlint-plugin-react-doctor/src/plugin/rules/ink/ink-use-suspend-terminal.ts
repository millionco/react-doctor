import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";

const CHILD_PROCESS_MODULE_NAMES = ["child_process", "node:child_process"];
const CHILD_PROCESS_METHOD_NAMES = new Set(["exec", "execFile", "spawn", "spawnSync"]);

const isUseAppCall = (node: EsTreeNode | null | undefined, context: RuleContext): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "CallExpression") &&
    resolveInkApiName(node.callee, context.scopes) === "useApp",
  );

const isInheritedStdio = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  return node.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "stdio" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === "inherit",
  );
};

const isSuspendTerminalCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    return (
      getStaticPropertyName(callee) === "suspendTerminal" && isUseAppCall(callee.object, context)
    );
  }
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (
    !symbol ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    !isNodeOfType(symbol.declarationNode.id, "ObjectPattern") ||
    !isUseAppCall(symbol.initializer, context)
  ) {
    return false;
  }
  const property = symbol.bindingIdentifier.parent;
  return Boolean(
    property &&
    isNodeOfType(property, "Property") &&
    getStaticPropertyKeyName(property, { allowComputedString: true }) === "suspendTerminal",
  );
};

const isInsideSuspendTerminal = (node: EsTreeNode, context: RuleContext): boolean => {
  let ancestorNode = node.parent;
  while (ancestorNode) {
    if (
      isNodeOfType(ancestorNode, "CallExpression") &&
      isSuspendTerminalCall(ancestorNode, context)
    ) {
      return true;
    }
    ancestorNode = ancestorNode.parent;
  }
  return false;
};

const isInsideUseInputHandler = (node: EsTreeNode, context: RuleContext): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  const hookCall = enclosingFunction?.parent;
  return Boolean(
    hookCall &&
    isNodeOfType(hookCall, "CallExpression") &&
    hookCall.arguments[0] === enclosingFunction &&
    resolveInkApiName(hookCall.callee, context.scopes) === "useInput",
  );
};

export const inkUseSuspendTerminal = defineRule({
  id: "ink-use-suspend-terminal",
  title: "Interactive child process bypasses Ink suspension",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.suspendTerminal,
  recommendation: "Run inherited-TTY child processes inside `useApp().suspendTerminal()`.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (context.scopes.symbolFor(node.callee)?.kind !== "import") return;
      const localName = node.callee.name;
      const importedName = CHILD_PROCESS_MODULE_NAMES.map((moduleName) =>
        getImportedNameFromModule(node, localName, moduleName),
      ).find(Boolean);
      if (!importedName || !CHILD_PROCESS_METHOD_NAMES.has(importedName)) return;
      if (!node.arguments.some(isInheritedStdio) || isInsideSuspendTerminal(node, context)) return;
      if (!isInsideUseInputHandler(node, context)) return;
      context.report({
        node,
        message: "Suspend Ink before giving an interactive child process control of the terminal.",
      });
    },
  }),
});
