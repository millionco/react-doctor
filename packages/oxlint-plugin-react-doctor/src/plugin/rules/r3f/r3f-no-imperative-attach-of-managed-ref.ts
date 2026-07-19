import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";

const IMPERATIVE_ATTACH_METHOD_NAMES = new Set(["add", "attach"]);
const THREE_OBJECT3D_CONSTRUCTOR_NAMES = new Set([
  "ArrayCamera",
  "BatchedMesh",
  "Bone",
  "Camera",
  "CubeCamera",
  "DirectionalLight",
  "Group",
  "HemisphereLight",
  "InstancedMesh",
  "Light",
  "Line",
  "LineLoop",
  "LineSegments",
  "LOD",
  "Mesh",
  "Object3D",
  "OrthographicCamera",
  "PerspectiveCamera",
  "PointLight",
  "Points",
  "Scene",
  "SkinnedMesh",
  "SpotLight",
  "Sprite",
]);

const isThreeModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three" || moduleSource === "three-stdlib" || moduleSource.startsWith("three/");

const hasThreeObject3DProvenance = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const provenance = getApiReferenceProvenance(candidate.callee, scopes);
    return Boolean(
      provenance &&
      isThreeModuleSource(provenance.moduleSource) &&
      THREE_OBJECT3D_CONSTRUCTOR_NAMES.has(provenance.apiName),
    );
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
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
  return hasThreeObject3DProvenance(symbol.initializer, scopes, visitedSymbolIds);
};

const useThreeSelectsScene = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  if (!isR3fApiCall(call, "useThree", context.scopes)) return false;
  const selectorExpression = call.arguments[0];
  if (!selectorExpression || isNodeOfType(selectorExpression, "SpreadElement")) return false;
  const selector = resolveLocalReactCallback(selectorExpression, context.scopes);
  return Boolean(
    selector &&
    functionReturnsMatchingExpression(
      selector,
      context.scopes,
      (returnedExpression) =>
        isR3fCallbackStateProperty(returnedExpression, selector, "scene", context.scopes),
      context.cfg,
    ),
  );
};

const hasUseThreeSceneProvenance = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (
    symbol.initializer &&
    isNodeOfType(symbol.initializer, "CallExpression") &&
    useThreeSelectsScene(symbol.initializer, context)
  ) {
    return true;
  }
  if (
    symbol.initializer &&
    getDestructuredBindingPropertyName(symbol.bindingIdentifier) === "scene" &&
    isR3fApiCall(symbol.initializer, "useThree", context.scopes)
  ) {
    return true;
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  return hasUseThreeSceneProvenance(symbol.initializer, context, visitedSymbolIds);
};

const hasR3fFrameSceneProvenance = (
  expression: EsTreeNode,
  frameCallbacks: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean =>
  [...frameCallbacks].some((callback) =>
    isR3fCallbackStateProperty(expression, callback, "scene", context.scopes),
  );

const hasSceneOwnershipProvenance = (
  expression: EsTreeNode,
  frameCallbacks: ReadonlySet<EsTreeNode>,
  managedRefSymbolIds: ReadonlySet<number>,
  context: RuleContext,
): boolean => {
  const refSymbol = resolveReactRefSymbol(stripParenExpression(expression), context.scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
  return (
    Boolean(refSymbol && managedRefSymbolIds.has(refSymbol.id)) ||
    hasThreeObject3DProvenance(expression, context.scopes) ||
    hasUseThreeSceneProvenance(expression, context) ||
    hasR3fFrameSceneProvenance(expression, frameCallbacks, context)
  );
};

const getCurrentRefSymbol = (
  expression: EsTreeNode,
  context: RuleContext,
): ReturnType<typeof resolveReactRefSymbol> => {
  const candidate = stripParenExpression(expression);
  return resolveReactRefSymbol(candidate, context.scopes, {
    includeCreateRef: true,
    resolveNamedAliases: true,
  });
};

export const r3fNoImperativeAttachOfManagedRef = defineRule({
  id: "r3f-no-imperative-attach-of-managed-ref",
  title: "Imperative attachment of an R3F-managed ref",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation:
    "Let R3F attach objects referenced by JSX. Do not add or attach the same ref.current imperatively",
  create: (context: RuleContext) => {
    const managedRefSymbolIds = new Set<number>();
    const imperativeAttachments: Array<{
      node: EsTreeNodeOfType<"CallExpression">;
      refSymbolId: number;
      receiver: EsTreeNode;
    }> = [];
    const frameCallbacks = new Set<EsTreeNode>();
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber || !isR3fHostIntrinsic(node)) return;
        const refAttribute = getAuthoritativeJsxAttribute(node.attributes, "ref");
        if (
          !refAttribute?.value ||
          !isNodeOfType(refAttribute.value, "JSXExpressionContainer") ||
          isNodeOfType(refAttribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const refExpression = stripParenExpression(refAttribute.value.expression);
        const refSymbol = isNodeOfType(refExpression, "Identifier")
          ? resolveConstIdentifierAlias(refExpression, context.scopes)
          : null;
        if (refSymbol) managedRefSymbolIds.add(refSymbol.id);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const frameCallback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (frameCallback) frameCallbacks.add(frameCallback);
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.callee, "MemberExpression") ||
          !IMPERATIVE_ATTACH_METHOD_NAMES.has(getStaticPropertyName(node.callee) ?? "")
        ) {
          return;
        }
        for (const argument of node.arguments) {
          if (isNodeOfType(argument, "SpreadElement")) continue;
          const refSymbol = getCurrentRefSymbol(argument, context);
          if (!refSymbol) continue;
          imperativeAttachments.push({
            node,
            refSymbolId: refSymbol.id,
            receiver: node.callee.object,
          });
          break;
        }
      },
      "Program:exit"() {
        for (const attachment of imperativeAttachments) {
          if (
            !managedRefSymbolIds.has(attachment.refSymbolId) ||
            !hasSceneOwnershipProvenance(
              attachment.receiver,
              frameCallbacks,
              managedRefSymbolIds,
              context,
            )
          ) {
            continue;
          }
          context.report({
            node: attachment.node,
            message:
              "This ref is already attached by R3F through JSX. Adding or attaching ref.current imperatively creates competing scene-graph ownership",
          });
        }
      },
    };
  },
});
