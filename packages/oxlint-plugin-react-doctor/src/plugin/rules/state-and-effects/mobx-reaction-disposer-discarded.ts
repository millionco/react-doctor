import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This `reaction`/`autorun` returns a disposer that is discarded, so the tracked computation can outlive its owner; keep the disposer and call it on teardown, or pass the call to `disposeOnUnmount`.";

// `when` auto-disposes after its predicate fires once, and `observe`/`intercept`
// are rare and easily confused with unrelated APIs — so only the two genuinely
// leak-prone MobX subscriptions are flagged.
const LEAKING_MOBX_SUBSCRIPTIONS = new Set(["reaction", "autorun"]);

const OPTIONS_ARGUMENT_INDEX: Record<string, number> = { autorun: 1, reaction: 2 };

const resolveLeakingSubscriptionName = (
  node: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  if (isNodeOfType(node.callee, "Identifier")) {
    const importedName = getImportedNameFromModule(node, node.callee.name, "mobx");
    if (importedName && LEAKING_MOBX_SUBSCRIPTIONS.has(importedName)) return importedName;
    return null;
  }
  // `mobx.autorun(...)` on a verified `import * as mobx from "mobx"` binding —
  // this still excludes Yup's `schema.when(...)` and `observer.observe(...)`.
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.computed &&
    isNodeOfType(node.callee.object, "Identifier") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    LEAKING_MOBX_SUBSCRIPTIONS.has(node.callee.property.name) &&
    isNamespaceImportFromModule(node, node.callee.object.name, "mobx")
  ) {
    return node.callee.property.name;
  }
  return null;
};

// A bare subscription at module scope runs once at import time and lives for
// the whole process by construction — there is no teardown moment at which
// the disposer could ever be called, so discarding it is the intended shape
// of app-lifetime store wiring.
const isEvaluatedAtModuleScope = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "StaticBlock")) {
      ancestor = ancestor.parent ?? null;
      continue;
    }
    if (isFunctionLike(ancestor)) return false;
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

// App-bootstrap wiring functions (`registerReactions`, `initStores`,
// `setupAutoruns`) exist to be called once for the process lifetime — the
// same no-teardown-moment argument as bare module scope.
const PROCESS_LIFETIME_WIRING_NAME_PATTERN = /^(?:register|init|setup|bootstrap|start|install)/i;

const enclosingFunctionNameOf = (functionNode: EsTreeNode): string | null => {
  if (
    isNodeOfType(functionNode, "FunctionDeclaration") &&
    isNodeOfType(functionNode.id, "Identifier")
  ) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  return null;
};

const isModuleScopedFunction = (functionNode: EsTreeNode): boolean => {
  let ancestor = functionNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) || isNodeOfType(ancestor, "ClassBody")) return false;
    if (isNodeOfType(ancestor, "Program")) return true;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// The constructor of a class instantiated at module scope in the same file
// (`export const themeStore = new ThemeStore()`) also runs once per process:
// the singleton's reactions live as long as the app.
const isProcessLifetimeWiring = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const wiringName = enclosingFunctionNameOf(ancestor);
      if (
        wiringName &&
        PROCESS_LIFETIME_WIRING_NAME_PATTERN.test(wiringName) &&
        isModuleScopedFunction(ancestor)
      ) {
        return true;
      }
      const methodDefinition = ancestor.parent;
      if (
        isNodeOfType(methodDefinition, "MethodDefinition") &&
        methodDefinition.kind === "constructor"
      ) {
        let classNode: EsTreeNode | null | undefined = methodDefinition.parent;
        while (classNode && !isNodeOfType(classNode, "ClassDeclaration")) {
          classNode = classNode.parent ?? null;
        }
        if (classNode && isNodeOfType(classNode.id, "Identifier")) {
          const className = classNode.id.name;
          let programRoot: EsTreeNode | null | undefined = classNode;
          while (programRoot && !isNodeOfType(programRoot, "Program")) {
            programRoot = programRoot.parent ?? null;
          }
          if (programRoot) {
            let instantiatedAtModuleScope = false;
            walkAst(programRoot, (child: EsTreeNode) => {
              if (instantiatedAtModuleScope) return false;
              if (
                isNodeOfType(child, "NewExpression") &&
                isNodeOfType(child.callee, "Identifier") &&
                child.callee.name === className &&
                isEvaluatedAtModuleScope(child)
              ) {
                instantiatedAtModuleScope = true;
                return false;
              }
            });
            if (instantiatedAtModuleScope) return true;
          }
        }
      }
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const mayCarryAbortSignal = (optionsArgument: unknown): boolean => {
  if (!optionsArgument) return false;
  if (!isNodeOfType(optionsArgument, "ObjectExpression")) return true;
  return optionsArgument.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    if (property.computed) return true;
    const isSignalProperty = isNodeOfType(property.key, "Identifier")
      ? property.key.name === "signal"
      : isNodeOfType(property.key, "Literal") && property.key.value === "signal";
    if (!isSignalProperty) return false;
    const value = property.value as EsTreeNode;
    if (isNodeOfType(value, "Identifier") && value.name === "undefined") return false;
    if (isNodeOfType(value, "Literal") && value.value == null) return false;
    if (isNodeOfType(value, "UnaryExpression") && value.operator === "void") return false;
    return true;
  });
};

const isDiscardedExpression = (call: EsTreeNode): boolean => {
  let expression: EsTreeNode = call;
  let parent = expression.parent;
  while (parent) {
    if (isNodeOfType(parent, "ExpressionStatement")) return true;
    if (
      isNodeOfType(parent, "ChainExpression") ||
      isNodeOfType(parent, "TSAsExpression") ||
      isNodeOfType(parent, "TSSatisfiesExpression") ||
      isNodeOfType(parent, "TSTypeAssertion") ||
      isNodeOfType(parent, "TSNonNullExpression") ||
      isNodeOfType(parent, "SequenceExpression") ||
      (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void")
    ) {
      expression = parent;
      parent = expression.parent;
      continue;
    }
    return false;
  }
  return false;
};

export const mobxReactionDisposerDiscarded = defineRule({
  id: "mobx-reaction-disposer-discarded",
  title: "MobX reaction disposer discarded",
  severity: "warn",
  category: "Bugs",
  requires: ["mobx"],
  recommendation:
    "Store the disposer returned by `reaction`/`autorun` and call it on teardown, or pass the call to `disposeOnUnmount(this, ...)`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const subscriptionName = resolveLeakingSubscriptionName(node);
      if (!subscriptionName) return;

      // The disposer is discarded only when the call is a standalone statement.
      // `const d = reaction(...)`, `this.x = reaction(...)`, and
      // `disposeOnUnmount(this, reaction(...))` all have non-statement parents.
      if (!isDiscardedExpression(node)) return;

      if (isEvaluatedAtModuleScope(node)) return;
      if (isProcessLifetimeWiring(node)) return;

      // A `signal` option is MobX's documented alternative disposal mechanism,
      // so discarding the disposer is correct there; opaque (non-literal)
      // options may carry one, so they get the benefit of the doubt.
      const optionsArgument = node.arguments[OPTIONS_ARGUMENT_INDEX[subscriptionName]];
      if (mayCarryAbortSignal(optionsArgument)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
