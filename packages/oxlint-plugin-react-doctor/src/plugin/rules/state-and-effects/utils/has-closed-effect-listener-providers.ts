import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isAllLiteralArrayExpression } from "../../../utils/is-all-literal-array-expression.js";
import { isNumericResultExpression } from "../../../utils/is-numeric-result-expression.js";

const closedEffectListenerProvidersByScopes = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedEffectListenerProviders = (scopes: ScopeAnalysis): boolean => {
  const cached = closedEffectListenerProvidersByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return false;
  let providersClosed = true;
  walkAst(program, (child) => {
    if (!providersClosed) return false;
    if (isNodeOfType(child, "MemberExpression")) {
      const method = getStaticPropertyKeyName(child, { allowComputedString: true });
      if (["constructor", "prototype", "__proto__"].includes(method ?? "")) providersClosed = false;
      if (
        isWithinAssignmentTarget(child) &&
        (method === null ||
          ["addEventListener", "removeEventListener", "log", "info"].includes(method))
      )
        providersClosed = false;
      if (child.computed && method === null && !isWithinAssignmentTarget(child)) {
        let value = findTransparentExpressionRoot(child);
        while (
          isNodeOfType(value.parent, "MemberExpression") &&
          stripParenExpression(value.parent.object) === stripParenExpression(value)
        )
          value = findTransparentExpressionRoot(value.parent);
        const use = value.parent;
        if (
          (isNodeOfType(use, "CallExpression") || isNodeOfType(use, "NewExpression")) &&
          stripParenExpression(use.callee) === stripParenExpression(value)
        ) {
          providersClosed = false;
          return;
        }
        const receiver = stripParenExpression(child.object);
        const sourceSymbol = isNodeOfType(receiver, "Identifier")
          ? scopes.symbolFor(receiver)
          : null;
        const initializer =
          sourceSymbol?.initializer && stripParenExpression(sourceSymbol.initializer);
        const hasPrimitiveArrayDataSource = Boolean(
          isNumericResultExpression(child.property) &&
          sourceSymbol?.kind === "const" &&
          initializer &&
          isAllLiteralArrayExpression(initializer) &&
          hasCompleteSymbolReferences(sourceSymbol, program, scopes) &&
          sourceSymbol.references.every((reference) => {
            if (reference.identifier === sourceSymbol.bindingIdentifier) return true;
            const referenceRoot = findTransparentExpressionRoot(reference.identifier);
            const member = referenceRoot.parent;
            return (
              reference.flag === "read" &&
              isNodeOfType(member, "MemberExpression") &&
              stripParenExpression(member.object) === stripParenExpression(referenceRoot) &&
              member.computed &&
              !isWithinAssignmentTarget(member)
            );
          }),
        );
        if (
          isNodeOfType(use, "VariableDeclarator") &&
          use.init === value &&
          isNodeOfType(use.id, "Identifier")
        ) {
          const symbol = scopes.symbolFor(use.id);
          if (
            !symbol ||
            !hasCompleteSymbolReferences(symbol, program, scopes) ||
            symbol.references.some((reference) => {
              if (reference.identifier === symbol.bindingIdentifier) return false;
              if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier))
                return true;
              const referenceRoot = findTransparentExpressionRoot(reference.identifier);
              const consumer = referenceRoot.parent;
              return !(
                isNodeOfType(consumer, "BinaryExpression") ||
                isNodeOfType(consumer, "TemplateLiteral") ||
                (isNodeOfType(consumer, "UnaryExpression") && consumer.operator !== "delete") ||
                ((isNodeOfType(consumer, "IfStatement") ||
                  isNodeOfType(consumer, "WhileStatement") ||
                  isNodeOfType(consumer, "DoWhileStatement") ||
                  isNodeOfType(consumer, "ForStatement")) &&
                  consumer.test === referenceRoot) ||
                isNodeOfType(consumer, "ExpressionStatement") ||
                (hasPrimitiveArrayDataSource &&
                  isNodeOfType(consumer, "AssignmentExpression") &&
                  consumer.right === referenceRoot &&
                  isNodeOfType(consumer.left, "MemberExpression"))
              );
            })
          )
            providersClosed = false;
        } else if (
          !hasPrimitiveArrayDataSource &&
          !(
            isNodeOfType(use, "BinaryExpression") ||
            isNodeOfType(use, "TemplateLiteral") ||
            (isNodeOfType(use, "UnaryExpression") && use.operator !== "delete") ||
            isNodeOfType(use, "ExpressionStatement")
          )
        )
          providersClosed = false;
      }
    }
    if (!isNodeOfType(child, "Identifier") || !scopes.isGlobalReference(child)) return;
    if (["EventTarget", "Window", "Document", "eval", "Function"].includes(child.name)) {
      providersClosed = false;
      return;
    }
    const protectedObject = [
      "window",
      "document",
      "console",
      "globalThis",
      "self",
      "global",
    ].includes(child.name);
    const reflectionObject = child.name === "Object" || child.name === "Reflect";
    if (!protectedObject && !reflectionObject) return;
    const root = findTransparentExpressionRoot(child);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      stripParenExpression(member.object) !== child ||
      member.computed ||
      member.optional
    ) {
      providersClosed = false;
      return;
    }
    const name = getStaticPropertyKeyName(member);
    if (reflectionObject) {
      const use = findTransparentExpressionRoot(member).parent;
      if (
        isWithinAssignmentTarget(member) ||
        name === null ||
        [
          "defineProperty",
          "defineProperties",
          "set",
          "setPrototypeOf",
          "assign",
          "getOwnPropertyDescriptor",
          "getOwnPropertyDescriptors",
        ].includes(name) ||
        !isNodeOfType(use, "CallExpression") ||
        use.optional ||
        stripParenExpression(use.callee) !== member
      )
        providersClosed = false;
      return;
    }
    if (
      isWithinAssignmentTarget(member) ||
      name === null ||
      [
        "EventTarget",
        "Window",
        "Document",
        "Object",
        "Reflect",
        "console",
        "window",
        "document",
        "globalThis",
        "self",
        "global",
        "constructor",
        "prototype",
        "__proto__",
        "defaultView",
      ].includes(name)
    ) {
      providersClosed = false;
      return;
    }
    if (["addEventListener", "removeEventListener", "log", "info"].includes(name)) {
      const use = findTransparentExpressionRoot(member).parent;
      if (
        !isNodeOfType(use, "CallExpression") ||
        use.optional ||
        stripParenExpression(use.callee) !== member
      )
        providersClosed = false;
    }
  });
  closedEffectListenerProvidersByScopes.set(scopes, providersClosed);
  return providersClosed;
};
