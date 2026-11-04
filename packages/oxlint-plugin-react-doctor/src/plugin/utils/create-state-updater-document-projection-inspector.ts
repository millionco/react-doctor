import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { collectConstAliasSymbols } from "./collect-const-alias-symbols.js";
import { collectFunctionReturnValues } from "./collect-function-return-values.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface DocumentProjection {
  properties: ReadonlySet<string>;
  methods: ReadonlyMap<string, DocumentProjection | null>;
}

interface DocumentProjectionOptions {
  scopes: ScopeAnalysis;
  hasClosedBinding: (symbols: SymbolDescriptor[]) => boolean;
  hasClosedFunctionBinding: (symbols: SymbolDescriptor[]) => boolean;
}

const RECTANGLE_PROJECTION: DocumentProjection = {
  properties: new Set(["top", "bottom", "left", "right", "width", "height", "x", "y"]),
  methods: new Map(),
};

const ELEMENT_PROJECTION: DocumentProjection = {
  properties: new Set(["scrollTop", "scrollHeight", "clientHeight"]),
  methods: new Map<string, DocumentProjection | null>([
    ["getBoundingClientRect", RECTANGLE_PROJECTION],
    ["addEventListener", null],
    ["removeEventListener", null],
  ]),
};

export const createStateUpdaterDocumentProjectionInspector = ({
  scopes,
  hasClosedBinding,
  hasClosedFunctionBinding,
}: DocumentProjectionOptions): ((document: EsTreeNode) => boolean) => {
  const valueProofs = new Map<EsTreeNode, Map<DocumentProjection, boolean>>();
  const functionProofs = new Map<EsTreeNode, boolean>();

  const isDocumentQuery = (node: EsTreeNode): boolean => {
    const call = stripParenExpression(node);
    if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
    const callee = stripParenExpression(call.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.optional ||
      getResolvedStaticPropertyName(callee, scopes) !== "querySelector"
    )
      return false;
    const receiver = stripParenExpression(callee.object);
    if (!isNodeOfType(receiver, "Identifier") || receiver.name !== "document") return false;
    const symbol = scopes.symbolFor(receiver);
    return !symbol || !hasRuntimeValueBinding(symbol);
  };

  const hasClosedQueryFunction = (owner: EsTreeNode): boolean => {
    const cached = functionProofs.get(owner);
    if (cached !== undefined) return cached;
    functionProofs.set(owner, false);
    if (
      !isFunctionLike(owner) ||
      owner.async ||
      ("generator" in owner && owner.generator) ||
      owner.params.length !== 0
    )
      return false;
    const bindings = getFunctionBindingSymbols(owner, scopes);
    if (
      !hasClosedFunctionBinding(bindings) ||
      bindings.some(
        (symbol) =>
          !isFunctionLike(symbol.scope.node) ||
          !["const", "function"].includes(symbol.kind) ||
          symbol.initializer !== owner,
      )
    )
      return false;
    const returnValues = collectFunctionReturnValues(owner);
    if (
      !returnValues?.every((value) => {
        const expression = stripParenExpression(value);
        return (
          (isNodeOfType(expression, "Literal") && expression.value === null) ||
          isDocumentQuery(expression)
        );
      })
    )
      return false;
    for (const symbol of bindings) {
      for (const reference of symbol.references) {
        const root = findTransparentExpressionRoot(reference.identifier);
        const call = root.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          call.optional ||
          call.arguments.length !== 0 ||
          !hasSafeValueUse(call, ELEMENT_PROJECTION)
        )
          return false;
      }
    }
    functionProofs.set(owner, true);
    return true;
  };

  const hasSafeValueUse = (value: EsTreeNode, projection: DocumentProjection): boolean => {
    const root = findTransparentExpressionRoot(value);
    const byProjection = valueProofs.get(root) ?? new Map<DocumentProjection, boolean>();
    const cached = byProjection.get(projection);
    if (cached !== undefined) return cached;
    byProjection.set(projection, false);
    valueProofs.set(root, byProjection);
    const parent = root.parent;
    let safe = false;
    if (isNodeOfType(parent, "IfStatement") && parent.test === root) safe = true;
    else if (
      isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "!" &&
      isNodeOfType(parent.parent, "IfStatement") &&
      parent.parent.test === parent
    )
      safe = true;
    else if (isNodeOfType(parent, "VariableDeclarator") && parent.init === root) {
      if (isNodeOfType(parent.id, "Identifier")) {
        const symbol = scopes.symbolFor(parent.id);
        if (symbol && symbol.scope.kind !== "module" && ["const", "let"].includes(symbol.kind)) {
          const aliases = collectConstAliasSymbols(symbol, scopes);
          safe = hasClosedBinding(aliases);
          for (const alias of aliases) {
            for (const reference of alias.references) {
              const referenceRoot = findTransparentExpressionRoot(reference.identifier);
              const declarator = referenceRoot.parent;
              if (
                isNodeOfType(declarator, "VariableDeclarator") &&
                declarator.init === referenceRoot &&
                isNodeOfType(declarator.id, "Identifier") &&
                aliases.some((candidate) => candidate === scopes.symbolFor(declarator.id))
              )
                continue;
              if (!hasSafeValueUse(referenceRoot, projection)) safe = false;
            }
          }
        }
      } else if (isNodeOfType(parent.id, "ObjectPattern")) {
        safe = parent.id.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.value, "Identifier") &&
            projection.properties.has(getResolvedStaticPropertyName(property, scopes) ?? ""),
        );
      }
    } else if (isNodeOfType(parent, "MemberExpression") && parent.object === root) {
      const propertyName = getResolvedStaticPropertyName(parent, scopes);
      const memberRoot = findTransparentExpressionRoot(parent);
      if (propertyName !== null && !isWithinAssignmentTarget(memberRoot)) {
        if (projection.properties.has(propertyName)) safe = true;
        else if (projection.methods.has(propertyName)) {
          const call = memberRoot.parent;
          if (
            isNodeOfType(call, "CallExpression") &&
            call.callee === memberRoot &&
            !call.optional &&
            !parent.optional
          ) {
            const resultProjection = projection.methods.get(propertyName);
            safe = resultProjection
              ? call.arguments.length === 0 && hasSafeValueUse(call, resultProjection)
              : isNodeOfType(call.parent, "ExpressionStatement");
          }
        }
      }
    } else if (
      projection === ELEMENT_PROJECTION &&
      (isNodeOfType(parent, "ReturnStatement") ||
        (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === root))
    ) {
      const owner = isNodeOfType(parent, "ArrowFunctionExpression")
        ? parent
        : findEnclosingFunction(parent);
      safe = Boolean(owner && hasClosedQueryFunction(owner));
    }
    byProjection.set(projection, safe);
    return safe;
  };

  return (document) => {
    const root = findTransparentExpressionRoot(document);
    const member = root.parent;
    const call = member?.parent;
    if (
      isNodeOfType(member, "MemberExpression") &&
      member.object === root &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === member &&
      isDocumentQuery(call)
    )
      return hasSafeValueUse(call, ELEMENT_PROJECTION);
    const owner = findEnclosingFunction(root);
    if (
      !owner ||
      (!isNodeOfType(owner, "ArrowFunctionExpression") &&
        !isNodeOfType(owner, "FunctionExpression")) ||
      owner.async ||
      owner.params.length !== 0 ||
      ("generator" in owner && owner.generator)
    )
      return false;
    const bindings = getFunctionBindingSymbols(owner, scopes);
    return (
      hasClosedFunctionBinding(bindings) &&
      bindings.every(
        (symbol) =>
          symbol.kind === "const" &&
          symbol.initializer === owner &&
          isFunctionLike(symbol.scope.node) &&
          symbol.references.length === 0,
      )
    );
  };
};
