import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isGlobalBrowserFunctionCall } from "../../utils/is-global-browser-function-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  analyzeOwnedLifecycleCleanup,
  analyzeOwnedLifecycleResource,
  expressionMatchesOwnedLifecycleResource,
  functionInvokesOwnedResourceMethod,
  ownedResourceHasMethodCall,
  type OwnedLifecycleResourceAnalysis,
} from "./utils/analyze-owned-lifecycle-resource.js";
import { getApiReferenceModuleSource } from "./utils/get-api-reference-module-source.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { R3F_PUBLIC_MODULES } from "./utils/r3f-public-modules.js";
import { R3F_WEBGPU_MODULES } from "./utils/r3f-webgpu-modules.js";
import { THREE_RENDER_METHOD_NAMES } from "./utils/three-render-method-names.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const RENDERER_CONSTRUCTORS = new Set(["WebGLRenderer", "WebGPURenderer"]);

interface AnimationFrameRegistration {
  call: EsTreeNodeOfType<"CallExpression">;
  handle: AnimationFrameHandle | null;
}

interface AnimationFrameHandle {
  symbol: SymbolDescriptor | null;
  refSymbol: SymbolDescriptor | null;
}

const isThreeModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three" || moduleSource === "three-stdlib" || moduleSource.startsWith("three/");

const isNullArgument = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const argument = call.arguments[0];
  return Boolean(isNodeOfType(argument, "Literal") && argument.value === null);
};

const isRetainedByUnusedLocalReactRef = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const referenceRoot = findTransparentExpressionRoot(reference);
  const assignment = referenceRoot.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== referenceRoot
  ) {
    return false;
  }
  const assignmentTarget = stripParenExpression(assignment.left);
  const refSymbol = resolveReactRefSymbol(assignmentTarget, scopes);
  const referenceFunction = findEnclosingFunction(reference);
  const refOwnerFunction = refSymbol ? findEnclosingFunction(refSymbol.declarationNode) : null;
  return Boolean(
    refSymbol &&
    isNodeOfType(assignmentTarget, "MemberExpression") &&
    refSymbol.references.every((refReference) => {
      const referenceRoot = findTransparentExpressionRoot(refReference.identifier);
      const memberExpression = referenceRoot.parent;
      return (
        isNodeOfType(memberExpression, "MemberExpression") &&
        memberExpression.object === referenceRoot &&
        getStaticPropertyName(memberExpression) === "current"
      );
    }) &&
    referenceFunction &&
    (referenceFunction === refOwnerFunction ||
      findEnclosingFunction(referenceFunction) === refOwnerFunction),
  );
};

const getAnimationFrameHandle = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): AnimationFrameHandle | null => {
  const callRoot = findTransparentExpressionRoot(call);
  const parent = callRoot.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === callRoot &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    const symbol = scopes.symbolFor(parent.id);
    return symbol ? { symbol, refSymbol: null } : null;
  }
  if (
    !isNodeOfType(parent, "AssignmentExpression") ||
    parent.operator !== "=" ||
    parent.right !== callRoot
  ) {
    return null;
  }
  const assignmentTarget = stripParenExpression(parent.left);
  if (isNodeOfType(assignmentTarget, "Identifier")) {
    const symbol = scopes.symbolFor(assignmentTarget);
    return symbol ? { symbol, refSymbol: null } : null;
  }
  const refSymbol = resolveReactRefSymbol(assignmentTarget, scopes);
  if (refSymbol) return { symbol: null, refSymbol };
  return null;
};

const expressionMatchesAnimationFrameHandle = (
  expression: EsTreeNode,
  handle: AnimationFrameHandle,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (handle.symbol) {
    return (
      isNodeOfType(candidate, "Identifier") && scopes.symbolFor(candidate)?.id === handle.symbol.id
    );
  }
  return Boolean(
    handle.refSymbol && resolveReactRefSymbol(candidate, scopes)?.id === handle.refSymbol.id,
  );
};

const animationFrameHandleIsNotOverwritten = (
  registration: AnimationFrameRegistration,
  ownerFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const handle = registration.handle;
  if (!handle) return false;
  const registrationRoot = findTransparentExpressionRoot(registration.call);
  let isOverwritten = false;
  walkAst(ownerFunction, (candidate) => {
    if (isOverwritten) return false;
    if (
      isNodeOfType(candidate, "AssignmentExpression") &&
      expressionMatchesAnimationFrameHandle(candidate.left, handle, scopes) &&
      candidate.right !== registrationRoot
    ) {
      isOverwritten = true;
      return false;
    }
    if (
      isNodeOfType(candidate, "UpdateExpression") &&
      expressionMatchesAnimationFrameHandle(candidate.argument, handle, scopes)
    ) {
      isOverwritten = true;
      return false;
    }
  });
  return !isOverwritten;
};

const collectRendererRenderFunctions = (
  analysis: OwnedLifecycleResourceAnalysis,
  scopes: ScopeAnalysis,
): Set<EsTreeNode> => {
  const renderFunctions = new Set<EsTreeNode>();
  walkAst(analysis.ownerFunction, (candidate) => {
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isNodeOfType(candidate.callee, "MemberExpression") ||
      !THREE_RENDER_METHOD_NAMES.has(getStaticPropertyName(candidate.callee) ?? "") ||
      !expressionMatchesOwnedLifecycleResource(candidate.callee.object, analysis, scopes)
    ) {
      return;
    }
    const renderFunction = findEnclosingFunction(candidate);
    if (renderFunction) renderFunctions.add(renderFunction);
  });
  return renderFunctions;
};

const collectAnimationFrameRegistrations = (
  analysis: OwnedLifecycleResourceAnalysis,
  scopes: ScopeAnalysis,
): AnimationFrameRegistration[] => {
  const renderFunctions = collectRendererRenderFunctions(analysis, scopes);
  if (renderFunctions.size === 0) return [];
  const registrations: AnimationFrameRegistration[] = [];
  walkAst(analysis.ownerFunction, (candidate) => {
    const candidateFunction = findEnclosingFunction(candidate);
    if (
      !isNodeOfType(candidate, "CallExpression") ||
      !isGlobalBrowserFunctionCall(candidate, "requestAnimationFrame", scopes) ||
      !candidateFunction ||
      !renderFunctions.has(candidateFunction)
    ) {
      return;
    }
    registrations.push({ call: candidate, handle: getAnimationFrameHandle(candidate, scopes) });
  });
  return registrations;
};

const cleanupCancelsAnimationFrame = (
  cleanupFunction: EsTreeNode,
  handle: AnimationFrameHandle,
  scopes: ScopeAnalysis,
): boolean => {
  let didCancelAnimationFrame = false;
  walkFunctionExecution(cleanupFunction, scopes, (candidate) => {
    if (
      didCancelAnimationFrame ||
      !isNodeOfType(candidate, "CallExpression") ||
      !isGlobalBrowserFunctionCall(candidate, "cancelAnimationFrame", scopes)
    ) {
      return;
    }
    const handleArgument = candidate.arguments[0];
    if (
      handleArgument &&
      !isNodeOfType(handleArgument, "SpreadElement") &&
      expressionMatchesAnimationFrameHandle(handleArgument, handle, scopes)
    ) {
      didCancelAnimationFrame = true;
    }
  });
  return didCancelAnimationFrame;
};

const isRendererSuppliedToR3fCanvas = (
  analysis: OwnedLifecycleResourceAnalysis,
  context: RuleContext,
): boolean => {
  const matchesOwnedRenderer = (expression: EsTreeNode): boolean => {
    return expressionMatchesOwnedLifecycleResource(expression, analysis, context.scopes);
  };
  let isSupplied = false;
  walkAst(analysis.ownerFunction, (candidate) => {
    if (isSupplied || !isNodeOfType(candidate, "JSXAttribute")) return;
    const openingElement = candidate.parent;
    if (
      !isNodeOfType(candidate.name, "JSXIdentifier") ||
      !isNodeOfType(openingElement, "JSXOpeningElement") ||
      !candidate.value ||
      !isNodeOfType(candidate.value, "JSXExpressionContainer") ||
      isNodeOfType(candidate.value.expression, "JSXEmptyExpression")
    ) {
      return;
    }
    const moduleSource = getApiReferenceModuleSource(openingElement.name, "Canvas", context.scopes);
    if (
      !moduleSource ||
      (candidate.name.name !== "gl" &&
        !(candidate.name.name === "renderer" && R3F_WEBGPU_MODULES.has(moduleSource))) ||
      !R3F_PUBLIC_MODULES.has(moduleSource)
    ) {
      return;
    }
    const suppliedExpression = candidate.value.expression;
    if (matchesOwnedRenderer(suppliedExpression)) {
      isSupplied = true;
      return;
    }
    const factory = resolveExactLocalFunction(suppliedExpression, context.scopes);
    if (
      factory &&
      functionReturnsMatchingExpression(
        factory,
        context.scopes,
        matchesOwnedRenderer,
        context.cfg,
        "every",
      )
    ) {
      isSupplied = true;
    }
  });
  return isSupplied;
};

export const threeRequireRendererCleanup = defineRule({
  id: "three-require-renderer-cleanup",
  title: "Undisposed Three.js renderer",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Dispose component-owned renderers and stop their animation loop or animation frame in matching React cleanup",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const provenance = getApiReferenceProvenance(node.callee, context.scopes);
      if (
        !provenance ||
        !RENDERER_CONSTRUCTORS.has(provenance.apiName) ||
        !isThreeModuleSource(provenance.moduleSource)
      ) {
        return;
      }
      const analysis = analyzeOwnedLifecycleResource(node, context, {
        isBorrowedReference: (reference) =>
          isRetainedByUnusedLocalReactRef(reference, context.scopes),
      });
      if (
        !analysis ||
        analysis.hasUnknownOwnershipTransfer ||
        isRendererSuppliedToR3fCanvas(analysis, context)
      ) {
        return;
      }
      const disposeCleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
        functionInvokesOwnedResourceMethod(cleanupFunction, analysis, "dispose", context.scopes),
      );
      const startsAnimationLoop = ownedResourceHasMethodCall(
        analysis,
        "setAnimationLoop",
        context.scopes,
        (call) => !isNullArgument(call),
      );
      const animationLoopCleanup = startsAnimationLoop
        ? analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
            functionInvokesOwnedResourceMethod(
              cleanupFunction,
              analysis,
              "setAnimationLoop",
              context.scopes,
              isNullArgument,
            ),
          )
        : { isProven: true, isUnknown: false };
      const animationFrameRegistrations = collectAnimationFrameRegistrations(
        analysis,
        context.scopes,
      );
      const animationFrameCleanup = animationFrameRegistrations.every((registration) => {
        const handle = registration.handle;
        if (
          !handle ||
          !animationFrameHandleIsNotOverwritten(
            registration,
            analysis.ownerFunction,
            context.scopes,
          )
        ) {
          return false;
        }
        const cleanup = analyzeOwnedLifecycleCleanup(analysis, context, (cleanupFunction) =>
          cleanupCancelsAnimationFrame(cleanupFunction, handle, context.scopes),
        );
        return cleanup.isProven || cleanup.isUnknown;
      });
      if (
        (disposeCleanup.isProven || disposeCleanup.isUnknown) &&
        (animationLoopCleanup.isProven || animationLoopCleanup.isUnknown) &&
        animationFrameCleanup
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This component-owned renderer is not fully released. Dispose it and stop its setAnimationLoop or requestAnimationFrame work in matching React cleanup",
      });
    },
  }),
});
