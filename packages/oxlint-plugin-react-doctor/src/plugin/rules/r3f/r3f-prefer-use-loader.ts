import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { isR3fReactApiCall } from "./utils/is-r3f-react-api-call.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const REACT_EFFECT_API_NAMES = new Set(["useEffect", "useLayoutEffect"]);
const R3F_CONTEXT_HOOK_NAMES = ["useFrame", "useThree"];
const IMPERATIVE_LOADER_METHOD_NAMES = new Set(["load", "loadAsync"]);
const THREE_CORE_LOADER_NAMES = new Set([
  "AnimationLoader",
  "AudioLoader",
  "BufferGeometryLoader",
  "CubeTextureLoader",
  "FileLoader",
  "ImageBitmapLoader",
  "ImageLoader",
  "MaterialLoader",
  "ObjectLoader",
  "TextureLoader",
]);

const isKnownLoaderConstructor = (constructorNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const provenance = getApiReferenceProvenance(constructorNode, scopes);
  if (!provenance) return false;
  if (provenance.moduleSource === "three") {
    return THREE_CORE_LOADER_NAMES.has(provenance.apiName);
  }
  if (!provenance.apiName.endsWith("Loader")) return false;
  return (
    provenance.moduleSource === "three-stdlib" ||
    provenance.moduleSource.startsWith("three/addons/loaders/") ||
    provenance.moduleSource.startsWith("three/examples/jsm/loaders/")
  );
};

const resolvesToKnownLoaderInstance = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    return isKnownLoaderConstructor(candidate.callee, scopes);
  }
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const loaderSymbol = resolveConstIdentifierAlias(candidate, scopes);
  if (loaderSymbol?.kind !== "const" || !loaderSymbol.initializer) return false;
  const loaderInitializer = stripParenExpression(loaderSymbol.initializer);
  return (
    isNodeOfType(loaderInitializer, "NewExpression") &&
    isKnownLoaderConstructor(loaderInitializer.callee, scopes)
  );
};

const isImperativeLoaderCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  IMPERATIVE_LOADER_METHOD_NAMES.has(getStaticPropertyName(node.callee) ?? "") &&
  resolvesToKnownLoaderInstance(node.callee.object, scopes);

const ownerRunsInsideR3f = (effectCall: EsTreeNode, context: RuleContext): boolean => {
  const ownerFunction = findEnclosingFunction(effectCall);
  if (!ownerFunction) return false;
  let isInsideR3f = false;
  walkAst(ownerFunction, (candidate) => {
    if (isInsideR3f) return false;
    if (candidate !== ownerFunction && isFunctionLike(candidate)) return false;
    if (isNodeOfType(candidate, "JSXElement") && isR3fCanvas(candidate.openingElement, context)) {
      return false;
    }
    if (
      isNodeOfType(candidate, "CallExpression") &&
      R3F_CONTEXT_HOOK_NAMES.some((hookName) => isR3fApiCall(candidate, hookName, context.scopes))
    ) {
      isInsideR3f = true;
      return false;
    }
    if (isNodeOfType(candidate, "JSXOpeningElement") && isR3fHostIntrinsic(candidate)) {
      isInsideR3f = true;
      return false;
    }
  });
  return isInsideR3f;
};

export const r3fPreferUseLoader = defineRule({
  id: "r3f-prefer-use-loader",
  title: "Imperative Three.js loader in a React effect",
  category: "Performance",
  severity: "warn",
  requires: ["r3f:3"],
  recommendation:
    "Load render resources with R3F useLoader so Suspense caching can share and deduplicate them",
  create: (context: RuleContext) => {
    const reportedCalls = new Set<EsTreeNode>();
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !importsReactThreeFiber ||
          !isR3fReactApiCall(node, REACT_EFFECT_API_NAMES, context.scopes) ||
          !ownerRunsInsideR3f(node, context)
        ) {
          return;
        }
        const callbackArgument = node.arguments[0];
        if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
        const effectCallback = resolveLocalReactCallback(callbackArgument, context.scopes);
        if (!effectCallback) return;
        walkFunctionExecution(effectCallback, context.scopes, (candidate) => {
          if (reportedCalls.has(candidate) || !isImperativeLoaderCall(candidate, context.scopes)) {
            return;
          }
          reportedCalls.add(candidate);
          context.report({
            node: candidate,
            message:
              "This Three.js loader runs imperatively in a React effect, bypassing R3F Suspense caching and resource deduplication. Load the asset with useLoader instead",
          });
        });
      },
    };
  },
});
