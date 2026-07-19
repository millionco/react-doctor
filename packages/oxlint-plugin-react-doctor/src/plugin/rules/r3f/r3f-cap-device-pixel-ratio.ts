import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const THREE_RENDERER_CONSTRUCTOR_NAMES = new Set(["WebGLRenderer", "WebGPURenderer"]);

const isThreeModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three" || moduleSource.startsWith("three/") || moduleSource === "three-stdlib";

const resolveRawDevicePixelRatio = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "+") {
    return resolveRawDevicePixelRatio(candidate.argument, context, visitedSymbolIds);
  }
  if (isNodeOfType(candidate, "BinaryExpression")) {
    const rawLeft = resolveRawDevicePixelRatio(candidate.left, context, new Set(visitedSymbolIds));
    const rawRight = resolveRawDevicePixelRatio(
      candidate.right,
      context,
      new Set(visitedSymbolIds),
    );
    if (rawLeft && !rawRight) {
      const rightOperand = stripParenExpression(candidate.right);
      if (
        isNodeOfType(rightOperand, "Literal") &&
        typeof rightOperand.value === "number" &&
        Number.isFinite(rightOperand.value) &&
        (candidate.operator === "+" ||
          candidate.operator === "-" ||
          ((candidate.operator === "*" ||
            candidate.operator === "/" ||
            candidate.operator === "**") &&
            rightOperand.value > 0))
      ) {
        return rawLeft;
      }
    }
    if (rawRight && !rawLeft) {
      const leftOperand = stripParenExpression(candidate.left);
      if (
        isNodeOfType(leftOperand, "Literal") &&
        typeof leftOperand.value === "number" &&
        Number.isFinite(leftOperand.value) &&
        (candidate.operator === "+" || (candidate.operator === "*" && leftOperand.value > 0))
      ) {
        return rawRight;
      }
    }
    return null;
  }
  if (isNodeOfType(candidate, "ArrayExpression") && candidate.elements.length === 2) {
    const upperBound = candidate.elements[1];
    return upperBound && !isNodeOfType(upperBound, "SpreadElement")
      ? resolveRawDevicePixelRatio(upperBound, context, new Set(visitedSymbolIds))
      : null;
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const receiver = stripParenExpression(candidate.object);
    return getStaticPropertyName(candidate) === "devicePixelRatio" &&
      isNodeOfType(receiver, "Identifier") &&
      (receiver.name === "window" || receiver.name === "globalThis") &&
      context.scopes.isGlobalReference(receiver)
      ? candidate
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  visitedSymbolIds.add(symbol.id);
  if (getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "devicePixelRatio") {
    const initializer = stripParenExpression(symbol.initializer);
    if (
      isNodeOfType(initializer, "Identifier") &&
      (initializer.name === "window" || initializer.name === "globalThis") &&
      context.scopes.isGlobalReference(initializer)
    ) {
      return candidate;
    }
  }
  if (symbol.declarationNode.id !== symbol.bindingIdentifier) return null;
  return resolveRawDevicePixelRatio(symbol.initializer, context, visitedSymbolIds);
};

const getExplicitObjectPropertyValue = (
  expression: EsTreeNode,
  propertyName: string,
): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "ObjectExpression")) return null;
  for (
    let propertyIndex = candidate.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = candidate.properties[propertyIndex];
    if (
      property &&
      isNodeOfType(property, "Property") &&
      property.kind === "init" &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === propertyName
    ) {
      return property.value;
    }
  }
  return null;
};

const lazyStateInitializerCreatesR3fRoot = (
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (
    getDestructuredBindingPropertyName(symbol.bindingIdentifier) !== "root" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.initializer, "CallExpression") ||
    !isR3fReactApiCall(symbol.initializer, "useState", context.scopes)
  ) {
    return false;
  }
  const initializer = symbol.initializer.arguments[0];
  if (!initializer || isNodeOfType(initializer, "SpreadElement")) return false;
  const callback = resolveLocalReactCallback(initializer, context.scopes);
  if (!callback) return false;
  let createsRoot = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (!createsRoot && isR3fApiCall(candidate, "createRoot", context.scopes)) createsRoot = true;
  });
  return createsRoot;
};

const isR3fRootReceiver = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isR3fApiCall(candidate, "createRoot", context.scopes)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (lazyStateInitializerCreatesR3fRoot(symbol, context)) return true;
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return isR3fRootReceiver(symbol.initializer, context, visitedSymbolIds);
};

const isThreeRendererReceiver = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const provenance = getApiReferenceProvenance(candidate.callee, context.scopes);
    return Boolean(
      provenance &&
      isThreeModuleSource(provenance.moduleSource) &&
      THREE_RENDERER_CONSTRUCTOR_NAMES.has(provenance.apiName),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isThreeRendererReceiver(symbol.initializer, context, visitedSymbolIds);
};

const useThreeSelectsSetDpr = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isR3fApiCall(call, "useThree", context.scopes)) return false;
  const selectorExpression = call.arguments[0];
  if (!selectorExpression || isNodeOfType(selectorExpression, "SpreadElement")) return false;
  const selector = resolveLocalReactCallback(selectorExpression, context.scopes);
  if (!selector) return false;
  return functionReturnsMatchingExpression(
    selector,
    context.scopes,
    (returnedExpression) =>
      isR3fCallbackStateProperty(returnedExpression, selector, "setDpr", context.scopes),
    context.cfg,
  );
};

const isR3fSetDprIdentifier = (
  identifier: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  const destructuredName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  if (destructuredName === "setDpr" && symbol.initializer) {
    const initializer = stripParenExpression(symbol.initializer);
    if (isR3fApiCall(initializer, "useThree", context.scopes)) return true;
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  const initializer = stripParenExpression(symbol.initializer);
  if (isNodeOfType(initializer, "CallExpression") && useThreeSelectsSetDpr(initializer, context)) {
    return true;
  }
  return isNodeOfType(initializer, "Identifier")
    ? isR3fSetDprIdentifier(initializer, context, visitedSymbolIds)
    : false;
};

export const r3fCapDevicePixelRatio = defineRule({
  id: "r3f-cap-device-pixel-ratio",
  title: "Unbounded device pixel ratio",
  category: "Performance",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Cap devicePixelRatio, commonly at 2, or pass an explicit DPR range so high-density displays do not multiply rendering work without a bound",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    const reportRawDpr = (expression: EsTreeNode): void => {
      const rawDpr = resolveRawDevicePixelRatio(expression, context);
      if (!rawDpr) return;
      context.report({
        node: rawDpr,
        message:
          "This uses the device's raw pixel ratio without a cap. High-density displays can multiply the rendered pixel count; use a bounded DPR or range",
      });
    };
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isR3fCanvas(node, context)) return;
        for (const attributeName of ["dpr", "pixelRatio"]) {
          const dprAttribute = getAuthoritativeJsxAttribute(node.attributes, attributeName);
          if (
            !dprAttribute?.value ||
            !isNodeOfType(dprAttribute.value, "JSXExpressionContainer") ||
            isNodeOfType(dprAttribute.value.expression, "JSXEmptyExpression")
          ) {
            continue;
          }
          reportRawDpr(dprAttribute.value.expression);
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(node.callee);
        const firstArgument = node.arguments[0];
        if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
        if (methodName === "configure" && isR3fRootReceiver(node.callee.object, context)) {
          const dprValue = getExplicitObjectPropertyValue(firstArgument, "dpr");
          if (dprValue) reportRawDpr(dprValue);
          return;
        }
        if (
          methodName === "setPixelRatio" &&
          isThreeRendererReceiver(node.callee.object, context)
        ) {
          reportRawDpr(firstArgument);
          return;
        }
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        const parent = node.parent;
        if (
          !importsReactThreeFiber ||
          !parent ||
          !isNodeOfType(parent, "CallExpression") ||
          parent.callee !== node ||
          !isR3fSetDprIdentifier(node, context)
        ) {
          return;
        }
        const firstArgument = parent.arguments[0];
        if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
        reportRawDpr(firstArgument);
      },
    };
  },
});
