import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getCalleeName } from "../../../utils/get-callee-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isOwnedCesiumEventListenerPair = (
  registration: EsTreeNodeOfType<"CallExpression">,
  release: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(registration.callee);
  const releaseCallee = stripParenExpression(release.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(releaseCallee, "MemberExpression") ||
    registration.optional ||
    callee.optional ||
    release.optional ||
    releaseCallee.optional
  ) {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const { scopes } = context;
  const event = scopes.symbolFor(receiver);
  const initializer = event?.initializer;
  const releaseReceiver = stripParenExpression(releaseCallee.object);
  if (
    event?.kind !== "const" ||
    !isNodeOfType(releaseReceiver, "Identifier") ||
    scopes.symbolFor(releaseReceiver) !== event ||
    !isNodeOfType(event.declarationNode, "VariableDeclarator") ||
    event.declarationNode.id !== event.bindingIdentifier ||
    !findEnclosingFunction(event.declarationNode) ||
    !isNodeOfType(initializer, "NewExpression") ||
    initializer.arguments.length !== 0 ||
    !isNodeOfType(initializer.callee, "Identifier")
  ) {
    return false;
  }
  const constructor = scopes.symbolFor(initializer.callee);
  const imported = resolveImportedApiReference(initializer.callee, scopes);
  if (
    constructor?.kind !== "import" ||
    imported?.source !== "cesium" ||
    imported.importedName !== "Event" ||
    !hasCompleteSymbolReferences(constructor, scopes.rootScope.node, scopes) ||
    !constructor.references.every(
      ({ identifier, flag }) =>
        flag === "read" &&
        isNodeOfType(identifier.parent, "NewExpression") &&
        identifier.parent.callee === identifier,
    )
  ) {
    return false;
  }
  const hasAnotherConstructorAccess = scopes.rootScope.symbols.some((symbol) => {
    if (symbol === constructor || symbol.kind !== "import") return false;
    const alternate = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
    return Boolean(
      alternate &&
      (alternate.source === "cesium" || alternate.source === "@cesium/engine") &&
      (alternate.importedName === "Event" ||
        alternate.importedName === "default" ||
        alternate.isNamespace),
    );
  });
  return (
    !hasAnotherConstructorAccess &&
    hasCompleteSymbolReferences(event, scopes.rootScope.node, scopes) &&
    event.references.every(({ identifier, flag }) => {
      const member = identifier.parent;
      const invocation = member?.parent;
      if (flag !== "read") return false;
      if (
        isNodeOfType(member, "ArrayExpression") &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.arguments[1] === member
      ) {
        return isReactHookCall(invocation, EFFECT_HOOK_NAMES, scopes);
      }
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== identifier ||
        member.computed ||
        !isNodeOfType(invocation, "CallExpression") ||
        invocation.callee !== member
      ) {
        return false;
      }
      return (
        invocation === registration ||
        invocation === release ||
        getCalleeName(invocation) === "raiseEvent"
      );
    })
  );
};
