import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { nodeDominatesNode } from "../../utils/node-dominates-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const ARRAY_MUTATING_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

// Name of the identifier a `key=` expression resolves to, or null. Mirrors
// the coverage of no-array-index-as-key's `extractIndexName` (bare
// identifier, `String(i)`/`Number(i)`, `i.toString()`, `` `${i}` ``) but
// returns the identifier regardless of its name — after `.fill()` the sole
// callback parameter IS the constant fill value whatever it is called, so
// the caller matches it against the map callback's single parameter.
const extractKeyIdentifierName = (node: EsTreeNode, context: RuleContext): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;

  if (isNodeOfType(node, "TemplateLiteral")) {
    const expressions = node.expressions ?? [];
    if (expressions.length === 1 && isNodeOfType(expressions[0], "Identifier")) {
      return expressions[0].name;
    }
    return null;
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "toString"
  ) {
    return node.callee.object.name;
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    context.scopes.isGlobalReference(node.callee) &&
    isNodeOfType(node.arguments?.[0], "Identifier")
  ) {
    return node.arguments[0].name;
  }

  return null;
};

// `Array(n)` or `new Array(n)` — returns the length argument node so the
// caller can suppress the harmless single-element case (`Array(1)`).
const getArrayConstructorLengthArgument = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedNode = stripParenExpression(node);
  const isArrayConstructor =
    (isNodeOfType(unwrappedNode, "CallExpression") ||
      isNodeOfType(unwrappedNode, "NewExpression")) &&
    isNodeOfType(unwrappedNode.callee, "Identifier") &&
    unwrappedNode.callee.name === "Array" &&
    context.scopes.isGlobalReference(unwrappedNode.callee);
  if (!isArrayConstructor) return null;
  return unwrappedNode.arguments?.[0] ?? null;
};

// Length argument of the `Array(n).fill(...)` / `new Array(n).fill(...)`
// receiver, or null when the receiver is not that shape.
const getFillReceiverLengthArgument = (
  receiver: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const unwrappedReceiver = stripParenExpression(receiver);
  if (!isNodeOfType(unwrappedReceiver, "CallExpression")) return null;
  const callee = stripParenExpression(unwrappedReceiver.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "fill"
  ) {
    return null;
  }
  return getArrayConstructorLengthArgument(stripParenExpression(callee.object), context);
};

const doesPatternBindName = (pattern: EsTreeNode | null | undefined, name: string): boolean => {
  if (!pattern) return false;
  const boundNames = new Set<string>();
  collectPatternNames(pattern, boundNames);
  return boundNames.has(name);
};

const doesDeclarationBindName = (statement: EsTreeNode | null | undefined, name: string): boolean =>
  Boolean(
    statement &&
    isNodeOfType(statement, "VariableDeclaration") &&
    statement.declarations.some((declarator) => doesPatternBindName(declarator.id, name)),
  );

// Whether anything between the key expression and the map callback rebinds
// (or reassigns) the callback parameter's name — a for-loop counter, a
// destructured `[i, v]` from `.entries()`, a nested-block const, a catch
// param, a switch-case declaration. When it does, the key identifier is
// NOT the fill element and the keys can be genuinely distinct.
const isKeyNameReboundBetween = (
  attributeNode: EsTreeNode,
  callback: EsTreeNode,
  keyName: string,
): boolean => {
  let current: EsTreeNode | null | undefined = attributeNode.parent;
  while (current && current !== callback) {
    if (isNodeOfType(current, "ForStatement")) {
      if (doesDeclarationBindName(current.init, keyName)) return true;
      if (
        isNodeOfType(current.init, "AssignmentExpression") &&
        isNodeOfType(current.init.left, "Identifier") &&
        current.init.left.name === keyName
      ) {
        return true;
      }
    }
    if (isNodeOfType(current, "ForOfStatement") || isNodeOfType(current, "ForInStatement")) {
      if (doesDeclarationBindName(current.left, keyName)) return true;
      if (isNodeOfType(current.left, "Identifier") && current.left.name === keyName) return true;
    }
    if (
      isNodeOfType(current, "BlockStatement") &&
      current.body.some((statement) => doesDeclarationBindName(statement, keyName))
    ) {
      return true;
    }
    if (
      isNodeOfType(current, "SwitchStatement") &&
      current.cases.some((switchCase) =>
        switchCase.consequent.some((statement) => doesDeclarationBindName(statement, keyName)),
      )
    ) {
      return true;
    }
    if (isNodeOfType(current, "CatchClause") && doesPatternBindName(current.param, keyName)) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const isConstDeclaredBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const declarator = bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.id !== bindingIdentifier) return false;
  const declaration = declarator.parent;
  return Boolean(
    declaration && isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const",
  );
};

// Whether the named array is reassigned, index-assigned, or hit with a
// mutating method anywhere in its scope — after that, elements may no
// longer be the identical fill value, so a param bound to them can be a
// legitimate key.
const isFilledArrayMutated = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const symbol = context.scopes.symbolFor(receiver);
  if (!symbol) return true;
  return symbol.references.some((reference) => {
    if (reference.flag !== "read") return true;
    const member = reference.identifier.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier
    ) {
      return false;
    }
    const memberParent = member.parent;
    if (isNodeOfType(memberParent, "AssignmentExpression") && memberParent.left === member) {
      return true;
    }
    return Boolean(
      isNodeOfType(memberParent, "CallExpression") &&
      memberParent.callee === member &&
      isNodeOfType(member.property, "Identifier") &&
      ARRAY_MUTATING_METHODS.has(member.property.name),
    );
  });
};

// Length argument of the fill chain the `.map` receiver resolves to: the
// inline `Array(n).fill(...).map(...)` chain, or an identifier whose sole
// `const` initializer is that chain and which is never mutated afterwards
// (`const slots = Array(n).fill(null); slots.map(...)`).
const resolveFillReceiverLengthArgument = (
  receiver: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const inlineLengthArgument = getFillReceiverLengthArgument(receiver, context);
  if (inlineLengthArgument) return inlineLengthArgument;

  if (!isNodeOfType(receiver, "Identifier")) return null;
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding || !binding.initializer) return null;
  if (!isConstDeclaredBinding(binding.bindingIdentifier)) return null;
  const initializerLengthArgument = getFillReceiverLengthArgument(binding.initializer, context);
  if (!initializerLengthArgument) return null;
  if (isFilledArrayMutated(receiver, context)) return null;
  return initializerLengthArgument;
};

// The nearest enclosing `.map(callback)` when the given node lives directly
// in that callback (not behind an intervening nested function), plus the
// receiver the `.map` was called on.
const findEnclosingMapCall = (
  node: EsTreeNode,
): {
  callback:
    | EsTreeNodeOfType<"ArrowFunctionExpression">
    | EsTreeNodeOfType<"FunctionExpression">
    | EsTreeNodeOfType<"FunctionDeclaration">;
  receiver: EsTreeNode;
  mapCall: EsTreeNodeOfType<"CallExpression">;
} | null => {
  let current = node;
  while (current.parent) {
    if (isFunctionLike(current)) {
      const parent = current.parent;
      if (
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.some((argument) => argument === current) &&
        isNodeOfType(parent.callee, "MemberExpression") &&
        isNodeOfType(parent.callee.property, "Identifier") &&
        parent.callee.property.name === "map"
      ) {
        return {
          callback: current,
          receiver: stripParenExpression(parent.callee.object),
          mapCall: parent,
        };
      }
      return null;
    }
    current = current.parent;
  }
  return null;
};

// The filled array escaping into a call (`shuffle(slots)`;
// `fillWithShuffledIndices(slots)`) may mutate its elements into distinct
// values before the map — the fill-elements-are-identical premise no longer
// holds.
const fillBindingPassedToDominatingCall = (
  receiver: EsTreeNode,
  mapCall: EsTreeNode,
  context: RuleContext,
): boolean => {
  const stripped = stripParenExpression(receiver);
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(stripped);
  if (!symbol) return false;
  return symbol.references.some((reference) => {
    const argument = findTransparentExpressionRoot(reference.identifier);
    const call = argument.parent;
    if (!call || !isNodeOfType(call, "CallExpression")) return false;
    const callee = stripParenExpression(call.callee as EsTreeNode);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "console" &&
      context.scopes.isGlobalReference(callee.object)
    ) {
      return false;
    }
    return Boolean(
      call.arguments.some((callArgument) => callArgument === argument) &&
      nodeDominatesNode(call, mapCall, context),
    );
  });
};

export const noFillMapElementAsKey = defineRule({
  id: "no-fill-map-element-as-key",
  title: "fill().map() first param is the element, not the index",
  severity: "warn",
  recommendation:
    "After `.fill(value)` every element is identical, so a lone `.map((n) => ...)` binds `n` to that value (whatever the parameter is named) and gives every child the same key. Add the index as the second parameter: `.map((_, index) => ...)`.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "key") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const keyName = extractKeyIdentifierName(node.value.expression, context);
      if (!keyName) return;

      const enclosingMap = findEnclosingMapCall(node);
      if (!enclosingMap) return;

      const parameters = enclosingMap.callback.params;
      if (parameters.length !== 1) return;
      const soleParameter = parameters[0];
      if (!isNodeOfType(soleParameter, "Identifier") || soleParameter.name !== keyName) return;

      if (isKeyNameReboundBetween(node, enclosingMap.callback, keyName)) return;
      const parameterSymbol = context.scopes.symbolFor(soleParameter);
      if (
        parameterSymbol?.references.some(
          (reference) =>
            reference.flag !== "read" && nodeDominatesNode(reference.identifier, node, context),
        )
      ) {
        return;
      }

      const lengthArgument = resolveFillReceiverLengthArgument(enclosingMap.receiver, context);
      if (!lengthArgument) return;
      if (
        isNodeOfType(lengthArgument, "Literal") &&
        typeof lengthArgument.value === "number" &&
        lengthArgument.value <= 1
      ) {
        return;
      }
      if (fillBindingPassedToDominatingCall(enclosingMap.receiver, enclosingMap.mapCall, context)) {
        return;
      }

      context.report({
        node,
        message: `Every item in this list gets the same key because \`.fill()\` makes every element identical and "${keyName}" is bound to that element, not the position — add the index as the second parameter (\`.map((_, ${keyName}) => …)\`) so React can tell your list items apart.`,
      });
    },
  }),
});
