import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findProgramRoot } from "./find-program-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isReactNamespaceImport } from "./is-react-api-call.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExpressionKey } from "./resolve-expression-key.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const aliasApisMayChangeByScopes = new WeakMap<ScopeAnalysis, boolean>();

const getObjectIntrinsicPath = (node: EsTreeNode, context: RuleContext): string | null => {
  const identity = resolveExpressionKey(node, context);
  if (!identity) return null;
  if (["global:globalThis", "global:window", "global:self", "global:global"].includes(identity)) {
    return "";
  }
  for (const prefix of [
    "global:Object",
    "global:globalThis.Object",
    "global:window.Object",
    "global:self.Object",
    "global:global.Object",
  ]) {
    if (identity === prefix || identity.startsWith(`${prefix}.`)) {
      return identity.slice(prefix.length);
    }
  }
  return null;
};

const aliasApisMayChange = (node: EsTreeNode, context: RuleContext): boolean => {
  const cached = aliasApisMayChangeByScopes.get(context.scopes);
  if (cached !== undefined) return cached;
  const program = findProgramRoot(node);
  if (!program) return true;
  let mayChange = false;
  walkAst(program, (child): boolean | void => {
    if (mayChange) return false;
    if (
      isNodeOfType(child, "Identifier") &&
      isReactNamespaceImport(child, context.scopes) &&
      hasPossibleStaticPropertyMutationOrEscape(child, "useRef", context.scopes)
    ) {
      mayChange = true;
      return false;
    }
    const intrinsicPath = getObjectIntrinsicPath(child, context);
    if (intrinsicPath !== null) {
      const expression = findTransparentExpressionRoot(child);
      const parent = expression.parent;
      const isBinding =
        isNodeOfType(child, "Identifier") &&
        context.scopes.symbolFor(child)?.bindingIdentifier === child;
      const isReceiver = isNodeOfType(parent, "MemberExpression") && parent.object === expression;
      const isImmutableAlias =
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === expression &&
        isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const";
      const isNativeCall =
        isNodeOfType(parent, "CallExpression") &&
        parent.callee === expression &&
        !intrinsicPath.startsWith(".prototype.");
      if (!isBinding && !isReceiver && !isImmutableAlias && !isNativeCall) {
        mayChange = true;
        return false;
      }
    }
    if (isNodeOfType(child, "MemberExpression")) {
      const property = getStaticPropertyName(child);
      if (
        property === "constructor" ||
        property === "__proto__" ||
        (getObjectIntrinsicPath(child.object, context) !== null && property === null)
      ) {
        mayChange = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "Identifier") &&
      getObjectIntrinsicPath(child, context) !== null &&
      isBindingAssignmentTarget(child)
    ) {
      mayChange = true;
      return false;
    }
    const written = isNodeOfType(child, "AssignmentExpression")
      ? child.left
      : isNodeOfType(child, "UpdateExpression") ||
          (isNodeOfType(child, "UnaryExpression") && child.operator === "delete")
        ? child.argument
        : null;
    if (
      written &&
      (getObjectIntrinsicPath(written, context) !== null ||
        (isNodeOfType(written, "MemberExpression") &&
          getObjectIntrinsicPath(written.object, context) !== null))
    ) {
      mayChange = true;
      return false;
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      child.init &&
      getObjectIntrinsicPath(child.init, context) !== null &&
      (!isNodeOfType(child.parent, "VariableDeclaration") || child.parent.kind !== "const")
    ) {
      mayChange = true;
      return false;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (
      (isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "getPrototypeOf") ||
      getObjectIntrinsicPath(callee, context)?.startsWith(".prototype.") ||
      child.arguments.some((argument) => {
        if (isNodeOfType(argument, "SpreadElement")) return false;
        return getObjectIntrinsicPath(argument, context) !== null;
      })
    ) {
      mayChange = true;
      return false;
    }
  });
  aliasApisMayChangeByScopes.set(context.scopes, mayChange);
  return mayChange;
};

const getDataDefinitionKey = (
  statement: EsTreeNode,
  aliasId: number,
  context: RuleContext,
): string | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const call = stripParenExpression(statement.expression);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length !== 3 || call.optional) {
    return null;
  }
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression") || callee.optional) return null;
  const receiver = stripParenExpression(callee.object);
  const [target, key, descriptor] = call.arguments;
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Object" ||
    !context.scopes.isGlobalReference(receiver) ||
    getStaticPropertyName(callee) !== "defineProperty" ||
    !target ||
    isNodeOfType(target, "SpreadElement") ||
    resolveConstIdentifierAlias(stripParenExpression(target), context.scopes)?.id !== aliasId ||
    !isNodeOfType(key, "Literal") ||
    typeof key.value !== "string" ||
    !isNodeOfType(descriptor, "ObjectExpression")
  ) {
    return null;
  }
  const fields = new Map<string, boolean>();
  for (const property of descriptor.properties) {
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      !name ||
      !["enumerable", "writable", "configurable"].includes(name) ||
      fields.has(name) ||
      !isNodeOfType(property.value, "Literal") ||
      typeof property.value.value !== "boolean"
    ) {
      return null;
    }
    fields.set(name, property.value.value);
  }
  return fields.get("writable") === true && fields.get("configurable") !== true ? key.value : null;
};

export const isProtectedRefValueAliasWrite = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): boolean => {
  if (assignment.operator !== "=") return false;
  const target = stripParenExpression(assignment.left);
  if (!isNodeOfType(target, "MemberExpression")) return false;
  const receiver = stripParenExpression(target.object);
  const key = getStaticPropertyName(target);
  const alias = resolveConstIdentifierAlias(receiver, context.scopes);
  const initializer = alias ? getDirectConstInitializer(alias) : null;
  const current = initializer ? stripParenExpression(initializer) : null;
  if (!alias || !key || !isNodeOfType(current, "MemberExpression") || current.optional) {
    return false;
  }
  const call = stripParenExpression(current.object);
  if (
    getStaticPropertyName(current) !== "current" ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isReactApiCall(call, "useRef", context.scopes)
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const hookSymbol = context.scopes.symbolFor(callee);
  if (
    !hookSymbol ||
    hookSymbol.references.some((reference) => {
      const expression = findTransparentExpressionRoot(reference.identifier);
      const parent = expression.parent;
      return (
        reference.flag !== "read" ||
        isBindingAssignmentTarget(reference.identifier) ||
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== expression
      );
    })
  ) {
    return false;
  }
  const initial = call.arguments[0];
  if (!initial || isNodeOfType(initial, "SpreadElement")) return false;
  const container = stripParenExpression(initial);
  if (!isNodeOfType(container, "ObjectExpression")) return false;
  const initialKeys = new Set<string>();
  for (const property of container.properties) {
    const name = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      !name ||
      name === "__proto__"
    ) {
      return false;
    }
    initialKeys.add(name);
  }
  const aliases = getEquivalentSymbols(receiver, context.scopes);
  if (
    aliases.some((symbol) =>
      symbol.references.some(
        (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
      ),
    )
  ) {
    return false;
  }
  const owner = context.cfg.enclosingFunction(assignment);
  if (!owner || !isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return false;
  const assignmentRoot = findTransparentExpressionRoot(assignment);
  const assignmentStatement = assignmentRoot.parent;
  if (
    !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
    assignmentStatement.expression !== assignmentRoot ||
    assignmentStatement.parent !== owner.body ||
    !context.cfg.isUnconditionalFromEntry(assignment) ||
    !isNodeReachableWithinFunction(assignment, context, {
      evaluatePrimitiveLiteralTruthiness: true,
    })
  ) {
    return false;
  }
  const declaration = alias.declarationNode.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== 1 ||
    owner.body.body[0] !== declaration ||
    context.cfg.enclosingFunction(current) !== owner ||
    aliasApisMayChange(assignment, context)
  ) {
    return false;
  }
  for (const statement of owner.body.body.slice(1)) {
    if (statement.range[0] >= assignment.range[0]) return false;
    if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      if (
        statement.declarations.every(
          (declarator) =>
            isNodeOfType(declarator.id, "Identifier") &&
            declarator.init &&
            resolveConstIdentifierAlias(stripParenExpression(declarator.init), context.scopes)
              ?.id === alias.id,
        )
      ) {
        continue;
      }
    }
    const definedKey = getDataDefinitionKey(statement, alias.id, context);
    if (!definedKey) return false;
    if (initialKeys.has(definedKey)) return false;
    if (definedKey === key) return true;
  }
  return false;
};
