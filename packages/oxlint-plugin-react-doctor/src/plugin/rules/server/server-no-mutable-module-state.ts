import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

const OBJECT_MUTATING_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);

const isMutableConstInitializer = (init: EsTreeNode | null | undefined): string | null => {
  if (!init) return null;
  if (isNodeOfType(init, "ArrayExpression")) return "[]";
  if (isNodeOfType(init, "ObjectExpression")) return "{}";
  if (
    isNodeOfType(init, "NewExpression") &&
    isNodeOfType(init.callee, "Identifier") &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(init.callee.name)
  ) {
    return `new ${init.callee.name}()`;
  }
  return null;
};

const getMemberPropertyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  if (!memberExpression.computed && isNodeOfType(memberExpression.property, "Identifier")) {
    return memberExpression.property.name;
  }
  if (
    memberExpression.computed &&
    isNodeOfType(memberExpression.property, "Literal") &&
    typeof memberExpression.property.value === "string"
  ) {
    return memberExpression.property.value;
  }
  return null;
};

// Walks up from a reference identifier through the member chain it roots
// (`store` -> `store.users` -> `store.users[0]`), so a mutation at any
// property depth is attributed back to the module binding.
const ascendMemberChain = (referenceIdentifier: EsTreeNode): EsTreeNode => {
  let chainTip: EsTreeNode = referenceIdentifier;
  while (
    chainTip.parent &&
    isNodeOfType(chainTip.parent, "MemberExpression") &&
    chainTip.parent.object === chainTip
  ) {
    chainTip = chainTip.parent;
  }
  return chainTip;
};

const isDirectContentsMutation = (referenceIdentifier: EsTreeNode): boolean => {
  const chainTip = ascendMemberChain(referenceIdentifier);
  if (chainTip === referenceIdentifier || !isNodeOfType(chainTip, "MemberExpression")) {
    return false;
  }
  const chainTipParent = chainTip.parent;
  if (!chainTipParent) return false;
  if (isNodeOfType(chainTipParent, "AssignmentExpression") && chainTipParent.left === chainTip) {
    return true;
  }
  if (isNodeOfType(chainTipParent, "UpdateExpression") && chainTipParent.argument === chainTip) {
    return true;
  }
  if (
    isNodeOfType(chainTipParent, "UnaryExpression") &&
    chainTipParent.operator === "delete" &&
    chainTipParent.argument === chainTip
  ) {
    return true;
  }
  if (isNodeOfType(chainTipParent, "CallExpression") && chainTipParent.callee === chainTip) {
    const methodName = getMemberPropertyName(chainTip);
    return methodName !== null && MUTATING_METHODS.has(methodName);
  }
  return false;
};

// A bare reference passed as a call argument mutates the container when the
// call is `Object.assign(X, …)`-shaped, or when the callee is a same-file
// function whose matching parameter is mutated in its body (one hop only —
// deeper escapes stay silent so read-only lookup helpers are never flagged).
const isMutatedThroughCallArgument = (
  referenceIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
  mayFollowCalleeHop: boolean,
): boolean => {
  const callExpression = referenceIdentifier.parent;
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  const callArguments = callExpression.arguments ?? [];
  const referenceArgumentIndex = callArguments.findIndex(
    (callArgument) => callArgument === referenceIdentifier,
  );
  if (referenceArgumentIndex === -1) return false;

  const callee = callExpression.callee;
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getMemberPropertyName(callee);
    return Boolean(
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Object" &&
      methodName !== null &&
      OBJECT_MUTATING_METHODS.has(methodName) &&
      referenceArgumentIndex === 0,
    );
  }

  if (!mayFollowCalleeHop || !isNodeOfType(callee, "Identifier")) return false;
  const calleeSymbol = scopes.symbolFor(callee);
  if (!calleeSymbol) return false;
  const calleeFunction = calleeSymbol.initializer;
  if (!isFunctionLike(calleeFunction)) return false;
  const parameter = calleeFunction.params?.[referenceArgumentIndex];
  if (!parameter || !isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (!parameterSymbol) return false;
  return parameterSymbol.references.some(
    (parameterReference) =>
      isDirectContentsMutation(parameterReference.identifier) ||
      isMutatedThroughCallArgument(parameterReference.identifier, scopes, false),
  );
};

// Module-level `const byId = cache` aliases share the container, so a
// mutation through any alias counts toward the original binding.
const collectAliasGroup = (
  containerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const aliasGroup = [containerSymbol];
  const seenSymbols = new Set([containerSymbol]);
  for (const groupSymbol of aliasGroup) {
    for (const reference of groupSymbol.references) {
      const declarator = reference.identifier.parent;
      if (
        !declarator ||
        !isNodeOfType(declarator, "VariableDeclarator") ||
        declarator.init !== reference.identifier
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declarator.id);
      if (!aliasSymbol || aliasSymbol.scope.kind !== "module" || seenSymbols.has(aliasSymbol)) {
        continue;
      }
      seenSymbols.add(aliasSymbol);
      aliasGroup.push(aliasSymbol);
    }
  }
  return aliasGroup;
};

// True when the binding's contents are written anywhere in the module: a
// member assignment (`X.y = …`, `X.a[i] = …` at any depth), `delete X.y`, a
// mutating method call (`X.push(...)`, `X.users.push(...)`, `X["set"](...)`),
// `Object.assign(X, …)`, or an escape into a same-file callee that mutates
// the parameter. Resolution is scope-aware, so a shadowed local or parameter
// of the same name never counts. A const container that is never mutated is
// an immutable lookup table — sharing it across requests is correct, so it
// must NOT be flagged.
const isContainerContentsMutated = (
  containerSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  collectAliasGroup(containerSymbol, scopes).some((groupSymbol) =>
    groupSymbol.references.some(
      (reference) =>
        isDirectContentsMutation(reference.identifier) ||
        isMutatedThroughCallArgument(reference.identifier, scopes, true),
    ),
  );

// HACK: in `"use server"` files, mutable module-level state (let/var, OR
// const-bound mutable containers like Map/Set/WeakMap/Array) is shared
// across concurrent requests. Different users can read each other's data,
// and serverless cold-starts produce inconsistent state. Per-request data
// must live inside the action, in headers/cookies, or in a request scope
// (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState = defineRule({
  id: "server-no-mutable-module-state",
  title: "Mutable module state on the server",
  severity: "error",
  recommendation:
    "Keep per-request data inside the action, or in headers, cookies, or `React.cache`. Module-scope `let`/`var` is shared by every request.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNodeOfType<"VariableDeclaration">) {
        if (!fileHasUseServerDirective) return;
        if (!isNodeOfType(node.parent, "Program")) return;

        for (const declarator of node.declarations ?? []) {
          const variableName = isNodeOfType(declarator.id, "Identifier")
            ? declarator.id.name
            : "<unnamed>";

          if (node.kind === "let" || node.kind === "var") {
            context.report({
              node: declarator,
              message: `Module-scoped ${node.kind} "${variableName}" is shared by every request, so any write to it leaks state between your users.`,
            });
            continue;
          }

          const containerKind = isMutableConstInitializer(declarator.init);
          if (!containerKind || !isNodeOfType(declarator.id, "Identifier")) continue;
          const containerSymbol = context.scopes.symbolFor(declarator.id);
          if (!containerSymbol) continue;
          if (isContainerContentsMutated(containerSymbol, context.scopes)) {
            context.report({
              node: declarator,
              message: `Module-scoped const "${variableName} = ${containerKind}" leaks state between your users, since every request shares it.`,
            });
          }
        }
      },
    };
  },
});
