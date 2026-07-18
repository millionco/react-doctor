import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const MESSAGE =
  "This `reaction`/`autorun` returns a disposer that is discarded, so the tracked computation can outlive its owner; keep the disposer and call it on teardown, or pass the call to `disposeOnUnmount`.";

// `when` auto-disposes after its predicate fires once, and `observe`/`intercept`
// are rare and easily confused with unrelated APIs — so only the two genuinely
// leak-prone MobX subscriptions are flagged.
const LEAKING_MOBX_SUBSCRIPTIONS = new Set(["reaction", "autorun"]);

const OPTIONS_ARGUMENT_INDEX: Record<string, number> = { autorun: 1, reaction: 2 };
const DISPOSER_VALUE_COERCION_NAMES = new Set(["Boolean", "Number", "String"]);

const resolveLeakingSubscriptionName = (
  node: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer || !isNodeOfType(binding.initializer, "ImportSpecifier")) {
      return null;
    }
    const importedName = getImportedNameFromModule(node, callee.name, "mobx");
    if (importedName && LEAKING_MOBX_SUBSCRIPTIONS.has(importedName)) return importedName;
    return null;
  }
  // `mobx.autorun(...)` on a verified `import * as mobx from "mobx"` binding —
  // this still excludes Yup's `schema.when(...)` and `observer.observe(...)`.
  if (
    isNodeOfType(callee, "MemberExpression") &&
    LEAKING_MOBX_SUBSCRIPTIONS.has(getStaticPropertyName(callee) ?? "")
  ) {
    const receiver = stripParenExpression(callee.object);
    const binding = isNodeOfType(receiver, "Identifier")
      ? findVariableInitializer(receiver, receiver.name)
      : null;
    if (
      isNodeOfType(receiver, "Identifier") &&
      binding?.initializer &&
      isNodeOfType(binding.initializer, "ImportNamespaceSpecifier") &&
      isNamespaceImportFromModule(node, receiver.name, "mobx")
    ) {
      return getStaticPropertyName(callee);
    }
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
    if (isFunctionLike(ancestor)) {
      const functionRoot = findTransparentExpressionRoot(ancestor);
      const invocation = functionRoot.parent;
      if (
        isNodeOfType(invocation, "CallExpression") &&
        stripParenExpression(invocation.callee) === functionRoot
      ) {
        ancestor = invocation.parent ?? null;
        continue;
      }
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

// App-bootstrap wiring functions (`registerReactions`, `initStores`,
// `setupAutoruns`) exist to be called once for the process lifetime — the
// same no-teardown-moment argument as bare module scope.
const PROCESS_LIFETIME_WIRING_NAME_PATTERN =
  /^(?:register.*(?:reactions?|autoruns?)|init.*(?:stores?|reactions?|autoruns?)|setup.*(?:stores?|reactions?|autoruns?)|bootstrap(?:app(?:lication)?|stores?|reactions?|autoruns?))$/i;

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

const directCallsOfFunction = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression">[] => {
  const bindingIdentifier = isNodeOfType(functionNode, "FunctionDeclaration")
    ? functionNode.id
    : isNodeOfType(functionNode.parent, "VariableDeclarator")
      ? functionNode.parent.id
      : null;
  if (!bindingIdentifier || !isNodeOfType(bindingIdentifier, "Identifier")) return [];
  const symbol = scopes.symbolFor(bindingIdentifier);
  if (!symbol) return [];
  return symbol.references.flatMap((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const parent = referenceRoot.parent;
    return isNodeOfType(parent, "CallExpression") && parent.callee === referenceRoot
      ? [parent]
      : [];
  });
};

const moduleInstantiatedClassSymbolIdsByAnalysis = new WeakMap<ScopeAnalysis, Set<number>>();

const getModuleInstantiatedClassSymbolIds = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<number> => {
  const cachedSymbolIds = moduleInstantiatedClassSymbolIdsByAnalysis.get(scopes);
  if (cachedSymbolIds) return cachedSymbolIds;
  const symbolIds = new Set<number>();
  const program = findProgramRoot(node);
  if (program) {
    walkAst(program, (candidate) => {
      if (!isNodeOfType(candidate, "NewExpression") || !isEvaluatedAtModuleScope(candidate)) return;
      const callee = stripParenExpression(candidate.callee);
      const symbol = isNodeOfType(callee, "Identifier") ? scopes.symbolFor(callee) : null;
      if (symbol?.kind === "class") symbolIds.add(symbol.id);
    });
  }
  moduleInstantiatedClassSymbolIdsByAnalysis.set(scopes, symbolIds);
  return symbolIds;
};

// The constructor of a class instantiated at module scope in the same file
// (`export const themeStore = new ThemeStore()`) also runs once per process:
// the singleton's reactions live as long as the app.
const isProcessLifetimeWiring = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const wiringName = enclosingFunctionNameOf(ancestor);
      if (
        wiringName &&
        PROCESS_LIFETIME_WIRING_NAME_PATTERN.test(wiringName) &&
        isModuleScopedFunction(ancestor)
      ) {
        const directCalls = directCallsOfFunction(ancestor, scopes);
        return directCalls.length === 0 || directCalls.every(isEvaluatedAtModuleScope);
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
          const classSymbol = scopes.symbolFor(classNode.id);
          if (
            classSymbol &&
            getModuleInstantiatedClassSymbolIds(node, scopes).has(classSymbol.id)
          ) {
            return true;
          }
        }
      }
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const mayCarryAbortSignal = (
  optionsArgument: EsTreeNode | undefined,
  scopes: RuleContext["scopes"],
): boolean => {
  if (!optionsArgument) return false;
  const options = resolveStableOptionsObject(optionsArgument, ["signal"], scopes);
  if (!options) return true;
  return options.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) return true;
    const isSignalProperty = propertyName === "signal";
    if (!isSignalProperty) return false;
    const value = property.value as EsTreeNode;
    if (isNodeOfType(value, "Identifier") && value.name === "undefined") return false;
    if (isNodeOfType(value, "Literal") && value.value == null) return false;
    if (isNodeOfType(value, "UnaryExpression") && value.operator === "void") return false;
    return true;
  });
};

const isDisposerOwnershipDiscarded = (call: EsTreeNode): boolean => {
  if (isResultDiscardedCall(call)) return true;
  const expressionRoot = findTransparentExpressionRoot(call);
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "UnaryExpression") || isNodeOfType(parent, "BinaryExpression")) {
    return true;
  }
  if (
    (isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "ForStatement")) &&
    parent.test === expressionRoot
  ) {
    return true;
  }
  if (
    (isNodeOfType(parent, "ConditionalExpression") && parent.test === expressionRoot) ||
    (isNodeOfType(parent, "SwitchStatement") && parent.discriminant === expressionRoot)
  ) {
    return true;
  }
  if (isNodeOfType(parent, "LogicalExpression") && parent.left === expressionRoot) {
    if (parent.operator === "&&") return true;
    return isResultDiscardedCall(parent);
  }
  const callee = isNodeOfType(parent, "CallExpression")
    ? stripParenExpression(parent.callee)
    : null;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments.some((argument) => argument === expressionRoot) &&
    isNodeOfType(callee, "Identifier") &&
    DISPOSER_VALUE_COERCION_NAMES.has(callee.name)
  ) {
    return true;
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
      if (!isDisposerOwnershipDiscarded(node)) return;

      if (isEvaluatedAtModuleScope(node)) return;
      if (isProcessLifetimeWiring(node, context.scopes)) return;

      // A `signal` option is MobX's documented alternative disposal mechanism,
      // so discarding the disposer is correct there; opaque (non-literal)
      // options may carry one, so they get the benefit of the doubt.
      const optionsArgument = node.arguments[OPTIONS_ARGUMENT_INDEX[subscriptionName]];
      if (mayCarryAbortSignal(optionsArgument, context.scopes)) return;

      context.report({ node, message: MESSAGE });
    },
  }),
});
