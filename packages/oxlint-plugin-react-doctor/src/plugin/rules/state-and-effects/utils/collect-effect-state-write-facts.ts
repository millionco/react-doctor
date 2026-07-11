import type { Reference } from "eslint-scope";
import { collectEffectInvokedFunctions } from "../../../utils/collect-effect-invoked-functions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readsPostMountValue } from "../../../utils/reads-post-mount-value.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getRef, getUpstreamRefs, resolveToFunction } from "./effect/ast.js";
import { isExternallyDrivenState } from "./effect/external-state.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import {
  getEffectFn,
  getUseStateDecl,
  hasCleanup,
  isProp,
  isState,
  isStateSetter,
} from "./effect/react.js";
import { hasUserInputSetterWriter } from "./has-user-input-setter-writer.js";
import { readsPostMountValueThroughLocals } from "./reads-post-mount-through-locals.js";

export interface EffectExecutionFrame {
  functionNode: EsTreeNode;
  invocation: EsTreeNode | null;
  isDeferred: boolean;
  introducedBindings: ReadonlySet<unknown>;
  substitutions: ReadonlyMap<unknown, EffectValueSubstitution>;
}

interface EffectValueSubstitution {
  expression: EsTreeNode;
  frame: EffectExecutionFrame;
}

interface EffectValueEvidence {
  sourceReferences: Set<Reference>;
  hasUnknownSource: boolean;
  hasDeferredIntroducedValue: boolean;
  readsExternalValue: boolean;
}

interface CollectedEffectStateWriteFact extends EffectStateWriteFact {
  executionNode: EsTreeNode;
}

export interface EffectStateWriteFact {
  callExpression: EsTreeNode;
  setterReference: Reference;
  stateDeclarator: EsTreeNode;
  sourceReferences: ReadonlyArray<Reference>;
  isDeferred: boolean;
  isRenderKnownCopy: boolean;
  matchesStateInitializer: boolean;
  resetsSourceState: boolean;
}

const SYNCHRONOUS_ITERATOR_METHOD_NAMES: ReadonlySet<string> = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
]);

const DEFERRING_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "requestIdleCallback",
  "setImmediate",
  "setInterval",
  "setTimeout",
]);

const DEFERRING_MEMBER_NAMES: ReadonlySet<string> = new Set(["catch", "finally", "then"]);

const PURE_GLOBAL_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Number",
  "Object",
  "String",
  "parseFloat",
  "parseInt",
]);

const PURE_GLOBAL_NAMESPACE_NAMES: ReadonlySet<string> = new Set(["JSON", "Math"]);

const PURE_MEMBER_TRANSFORM_NAMES: ReadonlySet<string> = new Set([
  "concat",
  "filter",
  "join",
  "map",
  "split",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
]);

const STORAGE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "indexedDB",
  "localStorage",
  "sessionStorage",
]);

const getStaticMemberName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression")) return null;
  if (!node.computed && isNodeOfType(node.property, "Identifier")) return node.property.name;
  if (node.computed && isNodeOfType(node.property, "Literal")) {
    return typeof node.property.value === "string" ? node.property.value : null;
  }
  return null;
};

const getMemberRoot = (node: EsTreeNode): EsTreeNode => {
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return current;
};

const getCallCalleeName = (callExpression: EsTreeNode): string | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  return getStaticMemberName(callee);
};

const getFunctionParameters = (functionNode: EsTreeNode): ReadonlyArray<EsTreeNode> =>
  isFunctionLike(functionNode) ? ((functionNode.params ?? []) as ReadonlyArray<EsTreeNode>) : [];

const getIdentifierBindingIdentity = (
  analysis: ProgramAnalysis,
  identifier: EsTreeNode,
): unknown | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  return getRef(analysis, identifier)?.resolved ?? null;
};

const getParameterBindingIdentity = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
  parameter: EsTreeNode,
): unknown => {
  if (!isNodeOfType(parameter, "Identifier")) return parameter;
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find(
      (candidate) =>
        candidate.name === parameter.name &&
        candidate.defs.some(
          (definition) =>
            definition.type === "Parameter" &&
            (definition.node as unknown as EsTreeNode) === functionNode,
        ),
    );
    if (variable) return variable;
  }
  return parameter;
};

const buildSubstitutions = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
  argumentExpressions: ReadonlyArray<EsTreeNode>,
  parentFrame: EffectExecutionFrame,
): ReadonlyMap<unknown, EffectValueSubstitution> => {
  const substitutions = new Map<unknown, EffectValueSubstitution>();
  const parameters = getFunctionParameters(functionNode);
  for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
    const parameter = parameters[parameterIndex];
    const argument = argumentExpressions[parameterIndex];
    if (!parameter || !argument || !isNodeOfType(parameter, "Identifier")) continue;
    substitutions.set(getParameterBindingIdentity(analysis, functionNode, parameter), {
      expression: argument,
      frame: parentFrame,
    });
  }
  return substitutions;
};

const isReactUseEffectEventCallee = (analysis: ProgramAnalysis, callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "MemberExpression")) {
    return (
      !callee.computed &&
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "React" &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "useEffectEvent"
    );
  }
  if (!isNodeOfType(callee, "Identifier")) return false;
  const calleeReference = getRef(analysis, callee);
  if (!calleeReference?.resolved) return callee.name === "useEffectEvent";
  return calleeReference.resolved.defs.some((definition) => {
    if (definition.type !== "ImportBinding") return false;
    const definitionNode = definition.node as unknown as EsTreeNode;
    if (!isNodeOfType(definitionNode, "ImportSpecifier")) return false;
    if (!isNodeOfType(definitionNode.imported as EsTreeNode, "Identifier")) return false;
    if ((definitionNode.imported as { name: string }).name !== "useEffectEvent") return false;
    const declaration = definitionNode.parent;
    return Boolean(
      declaration &&
      isNodeOfType(declaration, "ImportDeclaration") &&
      isNodeOfType(declaration.source as EsTreeNode, "Literal") &&
      declaration.source.value === "react",
    );
  });
};

const localUseEventPreservesCallback = (analysis: ProgramAnalysis, callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (!/^useEvent(?:Callback)?$/.test(callee.name)) return false;
  const calleeReference = getRef(analysis, callee);
  if (!calleeReference?.resolved) return false;
  const implementation = resolveToFunction(calleeReference);
  if (!implementation) return false;
  const callbackParameter = getFunctionParameters(implementation)[0];
  if (!callbackParameter || !isNodeOfType(callbackParameter, "Identifier")) return false;
  const callbackBinding = getParameterBindingIdentity(analysis, implementation, callbackParameter);
  const callbackRefDeclarators: EsTreeNode[] = [];
  walkAst(implementation, (child: EsTreeNode): boolean | void => {
    if (child !== implementation && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "VariableDeclarator")) return;
    if (!isNodeOfType(child.id, "Identifier")) return;
    if (!isNodeOfType(child.init, "CallExpression")) return;
    if (getCallCalleeName(child.init) !== "useRef") return;
    const refInitializer = child.init.arguments?.[0];
    if (
      !refInitializer ||
      getIdentifierBindingIdentity(analysis, refInitializer as EsTreeNode) !== callbackBinding
    ) {
      return;
    }
    callbackRefDeclarators.push(child);
  });
  if (callbackRefDeclarators.length === 0) return false;

  return getReturnedExpressions(implementation).some((returnedExpression) => {
    const returnedCall = stripParenExpression(returnedExpression);
    if (!isNodeOfType(returnedCall, "CallExpression")) return false;
    const returnedCalleeName = getCallCalleeName(returnedCall);
    if (returnedCalleeName !== "useCallback" && returnedCalleeName !== "useEffectEvent")
      return false;
    const stableCallback = returnedCall.arguments?.[0] as EsTreeNode | undefined;
    if (!stableCallback || !isFunctionLike(stableCallback)) return false;
    let forwardsCallback = false;
    walkAst(stableCallback, (child: EsTreeNode): boolean | void => {
      if (forwardsCallback) return false;
      if (child !== stableCallback && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "CallExpression")) return;
      const forwardedCallee = stripParenExpression(child.callee);
      if (!isNodeOfType(forwardedCallee, "MemberExpression")) return;
      if (getStaticMemberName(forwardedCallee) !== "current") return;
      if (!isNodeOfType(forwardedCallee.object, "Identifier")) return;
      const refReference = getRef(analysis, forwardedCallee.object);
      const refDeclarator = callbackRefDeclarators.find((declarator) =>
        refReference?.resolved?.defs.some(
          (definition) => (definition.node as unknown as EsTreeNode) === declarator,
        ),
      );
      if (!refDeclarator || !refReference?.resolved) return;
      const hasNonForwardingAssignment = refReference.resolved.references.some(
        (candidateReference) => {
          const identifier = candidateReference.identifier as unknown as EsTreeNode;
          const memberExpression = identifier.parent;
          const assignmentExpression = memberExpression?.parent;
          if (
            !memberExpression ||
            !isNodeOfType(memberExpression, "MemberExpression") ||
            getStaticMemberName(memberExpression) !== "current" ||
            !assignmentExpression ||
            !isNodeOfType(assignmentExpression, "AssignmentExpression") ||
            assignmentExpression.left !== memberExpression
          ) {
            return false;
          }
          return (
            getIdentifierBindingIdentity(analysis, assignmentExpression.right as EsTreeNode) !==
            callbackBinding
          );
        },
      );
      if (!hasNonForwardingAssignment) forwardsCallback = true;
    });
    return forwardsCallback;
  });
};

const resolveWrappedCallable = (analysis: ProgramAnalysis, node: EsTreeNode): EsTreeNode | null => {
  const candidate = stripParenExpression(node);
  if (isFunctionLike(candidate)) return candidate;
  if (isNodeOfType(candidate, "Identifier")) {
    const reference = getRef(analysis, candidate);
    if (!reference) return null;
    if (
      reference.resolved?.defs.some(
        (definition) => definition.type === "Parameter" || definition.type === "ImportBinding",
      )
    ) {
      return null;
    }
    const resolved = resolveToFunction(reference);
    if (resolved) return resolved;
    const definitionNode = reference.resolved?.defs[0]?.node as unknown as EsTreeNode | undefined;
    if (!definitionNode || !isNodeOfType(definitionNode, "VariableDeclarator")) return null;
    const initializer = definitionNode.init;
    if (!initializer || !isNodeOfType(initializer, "CallExpression")) return null;
    if (
      !isReactUseEffectEventCallee(analysis, initializer.callee as EsTreeNode) &&
      !localUseEventPreservesCallback(analysis, initializer.callee as EsTreeNode)
    ) {
      return null;
    }
    const callback = initializer.arguments?.[0];
    return callback && isFunctionLike(callback as EsTreeNode) ? (callback as EsTreeNode) : null;
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  if (getStaticMemberName(candidate) !== "current") return null;
  if (!isNodeOfType(candidate.object, "Identifier")) return null;
  const reference = getRef(analysis, candidate.object);
  const declarator = reference?.resolved?.defs
    .map((definition) => definition.node as unknown as EsTreeNode)
    .find((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.init, "CallExpression")) return null;
  if (getCallCalleeName(declarator.init) !== "useRef") return null;
  const initializer = declarator.init.arguments?.[0];
  if (!initializer || !isFunctionLike(initializer as EsTreeNode)) return null;
  const hasMutableCurrentAssignment = Boolean(
    reference?.resolved?.references.some((candidateReference) => {
      const identifier = candidateReference.identifier as unknown as EsTreeNode;
      const member = identifier.parent;
      const assignment = member?.parent;
      return Boolean(
        member &&
        isNodeOfType(member, "MemberExpression") &&
        getStaticMemberName(member) === "current" &&
        assignment &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.left === member,
      );
    }),
  );
  return hasMutableCurrentAssignment ? null : (initializer as EsTreeNode);
};

const functionInvokesItself = (analysis: ProgramAnalysis, functionNode: EsTreeNode): boolean => {
  let invokesItself = false;
  walkAst(functionNode, (child: EsTreeNode): boolean | void => {
    if (invokesItself) return false;
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const resolved = resolveWrappedCallable(analysis, child.callee as EsTreeNode);
    if (resolved === functionNode) {
      invokesItself = true;
      return false;
    }
  });
  return invokesItself;
};

const collectIntroducedBindings = (
  analysis: ProgramAnalysis,
  functionNode: EsTreeNode,
): ReadonlySet<unknown> => {
  const introducedBindings = new Set<unknown>();
  for (const parameter of getFunctionParameters(functionNode)) {
    if (isNodeOfType(parameter, "Identifier")) {
      introducedBindings.add(getParameterBindingIdentity(analysis, functionNode, parameter));
    }
  }
  return introducedBindings;
};

export const collectBoundedEffectExecutionFrames = (
  analysis: ProgramAnalysis,
  effectNode: EsTreeNode,
): ReadonlyArray<EffectExecutionFrame> => {
  const effectFunction = getEffectFn(analysis, effectNode);
  if (
    !effectFunction ||
    !isFunctionLike(effectFunction) ||
    (effectFunction as unknown as { async?: boolean }).async === true
  ) {
    return [];
  }
  const invokedFunctionEvidence = collectEffectInvokedFunctions(effectFunction);
  const rootFrame: EffectExecutionFrame = {
    functionNode: effectFunction,
    invocation: null,
    isDeferred: false,
    introducedBindings: new Set(),
    substitutions: new Map(),
  };
  const frames: EffectExecutionFrame[] = [rootFrame];

  walkAst(effectFunction, (child: EsTreeNode): boolean | void => {
    if (child !== effectFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    const calleeName = getCallCalleeName(child);
    const memberName = getStaticMemberName(callee);
    const isDeferringCall =
      (calleeName !== null && DEFERRING_CALLEE_NAMES.has(calleeName)) ||
      (memberName !== null && DEFERRING_MEMBER_NAMES.has(memberName));
    const isIteratorCall =
      memberName !== null &&
      SYNCHRONOUS_ITERATOR_METHOD_NAMES.has(memberName) &&
      isNodeOfType(callee, "MemberExpression");

    const enqueueFrame = (
      callableNode: EsTreeNode,
      argumentsForCallable: ReadonlyArray<EsTreeNode>,
      isDeferred: boolean,
      introducedBindings: ReadonlySet<unknown>,
      allowWithoutInvocationEvidence = false,
    ): void => {
      const callable = resolveWrappedCallable(analysis, callableNode);
      if (
        !callable ||
        (callable as unknown as { async?: boolean }).async === true ||
        callable === effectFunction
      ) {
        return;
      }
      if (functionInvokesItself(analysis, callable)) return;
      if (
        !allowWithoutInvocationEvidence &&
        !invokedFunctionEvidence.has(callable) &&
        !isNodeOfType(callableNode, "Identifier") &&
        !isNodeOfType(callableNode, "MemberExpression")
      ) {
        return;
      }
      frames.push({
        functionNode: callable,
        invocation: child,
        isDeferred,
        introducedBindings,
        substitutions: buildSubstitutions(analysis, callable, argumentsForCallable, rootFrame),
      });
    };

    if (isFunctionLike(callee)) {
      enqueueFrame(callee, (child.arguments ?? []) as ReadonlyArray<EsTreeNode>, false, new Set());
      return;
    }

    if (isIteratorCall && isNodeOfType(callee, "MemberExpression")) {
      const collectionExpression = callee.object as EsTreeNode;
      for (const argument of child.arguments ?? []) {
        const callable = resolveWrappedCallable(analysis, argument as EsTreeNode);
        if (!callable) continue;
        enqueueFrame(argument as EsTreeNode, [collectionExpression], false, new Set(), true);
      }
      return;
    }

    if (isDeferringCall) {
      for (const argument of child.arguments ?? []) {
        const callable = resolveWrappedCallable(analysis, argument as EsTreeNode);
        if (!callable) continue;
        const introducedBindings =
          memberName !== null && DEFERRING_MEMBER_NAMES.has(memberName)
            ? collectIntroducedBindings(analysis, callable)
            : new Set<unknown>();
        enqueueFrame(argument as EsTreeNode, [], true, introducedBindings, true);
      }
      return;
    }

    enqueueFrame(callee, (child.arguments ?? []) as ReadonlyArray<EsTreeNode>, false, new Set());
  });

  return frames;
};

const emptyEvidence = (): EffectValueEvidence => ({
  sourceReferences: new Set(),
  hasUnknownSource: false,
  hasDeferredIntroducedValue: false,
  readsExternalValue: false,
});

const mergeEvidence = (target: EffectValueEvidence, source: EffectValueEvidence): void => {
  for (const reference of source.sourceReferences) target.sourceReferences.add(reference);
  target.hasUnknownSource ||= source.hasUnknownSource;
  target.hasDeferredIntroducedValue ||= source.hasDeferredIntroducedValue;
  target.readsExternalValue ||= source.readsExternalValue;
};

const getReturnedExpressions = (functionNode: EsTreeNode): ReadonlyArray<EsTreeNode> => {
  if (!isFunctionLike(functionNode)) return [];
  if (!isNodeOfType(functionNode.body, "BlockStatement")) return [functionNode.body as EsTreeNode];
  const returnedExpressions: EsTreeNode[] = [];
  walkAst(functionNode.body, (child: EsTreeNode): boolean | void => {
    if (child !== functionNode.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      returnedExpressions.push(child.argument as EsTreeNode);
    }
  });
  return returnedExpressions;
};

const isOpaqueHookCall = (callExpression: EsTreeNode): boolean => {
  const calleeName = getCallCalleeName(callExpression);
  return Boolean(
    calleeName &&
    /^use[A-Z0-9]/.test(calleeName) &&
    calleeName !== "useMemo" &&
    calleeName !== "useCallback" &&
    calleeName !== "useEffectEvent",
  );
};

const isLocallyConstructedObjectMember = (
  reference: Reference,
  memberExpression: EsTreeNode,
): boolean =>
  isNodeOfType(memberExpression, "MemberExpression") &&
  reference.resolved?.defs.some((definition) => {
    const definitionNode = definition.node as unknown as EsTreeNode;
    return (
      isNodeOfType(definitionNode, "VariableDeclarator") &&
      Boolean(definitionNode.init) &&
      (isNodeOfType(definitionNode.init, "ObjectExpression") ||
        isNodeOfType(definitionNode.init, "ArrayExpression"))
    );
  }) === true;

const collectValueEvidence = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  frame: EffectExecutionFrame,
  remainingCallFrames: number,
  visitedBindings: Set<unknown> = new Set(),
): EffectValueEvidence => {
  const node = stripParenExpression(expression);
  const evidence = emptyEvidence();

  if (readsPostMountValue(node) || readsPostMountValueThroughLocals(node, frame.functionNode)) {
    evidence.readsExternalValue = true;
    return evidence;
  }
  const root = getMemberRoot(node);
  if (isNodeOfType(root, "Identifier") && STORAGE_GLOBAL_NAMES.has(root.name)) {
    evidence.readsExternalValue = true;
    return evidence;
  }
  if (
    isNodeOfType(node, "Literal") ||
    isNodeOfType(node, "TemplateElement") ||
    isNodeOfType(node, "ThisExpression")
  ) {
    return evidence;
  }

  if (isNodeOfType(node, "Identifier")) {
    if (node.name === "undefined" || node.name === "NaN" || node.name === "Infinity") {
      return evidence;
    }
    const reference = getRef(analysis, node);
    if (!reference) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const bindingIdentity = reference.resolved ?? node;
    if (frame.introducedBindings.has(bindingIdentity)) {
      const parent = node.parent;
      if (
        parent &&
        isNodeOfType(parent, "SpreadElement") &&
        parent.parent &&
        isNodeOfType(parent.parent, "ObjectExpression")
      ) {
        return evidence;
      }
      evidence.hasDeferredIntroducedValue = true;
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const substitution = frame.substitutions.get(bindingIdentity);
    if (substitution) {
      return collectValueEvidence(
        analysis,
        substitution.expression,
        substitution.frame,
        remainingCallFrames,
        visitedBindings,
      );
    }
    if (isProp(analysis, reference) || isState(analysis, reference)) {
      evidence.sourceReferences.add(reference);
      if (isState(analysis, reference) && isExternallyDrivenState(analysis, reference)) {
        evidence.readsExternalValue = true;
      }
      return evidence;
    }
    if (!reference.resolved || visitedBindings.has(reference.resolved)) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    visitedBindings.add(reference.resolved);
    const definitions = reference.resolved.defs;
    if (definitions.some((definition) => definition.type === "ImportBinding")) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    if (
      reference.resolved.references.some(
        (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
      )
    ) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const initializer = definitions
      .map((definition) => definition.node as unknown as EsTreeNode)
      .find(
        (definitionNode) =>
          isNodeOfType(definitionNode, "VariableDeclarator") && Boolean(definitionNode.init),
      );
    if (!initializer || !isNodeOfType(initializer, "VariableDeclarator") || !initializer.init) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    if (isNodeOfType(initializer.init, "CallExpression") && isOpaqueHookCall(initializer.init)) {
      evidence.readsExternalValue = true;
      return evidence;
    }
    return collectValueEvidence(
      analysis,
      initializer.init as EsTreeNode,
      frame,
      remainingCallFrames,
      visitedBindings,
    );
  }

  if (isNodeOfType(node, "MemberExpression")) {
    if (isNodeOfType(node.object, "Identifier")) {
      const objectReference = getRef(analysis, node.object);
      if (objectReference && isLocallyConstructedObjectMember(objectReference, node)) {
        evidence.hasUnknownSource = true;
        return evidence;
      }
    }
    mergeEvidence(
      evidence,
      collectValueEvidence(
        analysis,
        node.object as EsTreeNode,
        frame,
        remainingCallFrames,
        new Set(visitedBindings),
      ),
    );
    if (node.computed) {
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          node.property as EsTreeNode,
          frame,
          remainingCallFrames,
          new Set(visitedBindings),
        ),
      );
    }
    return evidence;
  }

  if (isNodeOfType(node, "CallExpression")) {
    if (isOpaqueHookCall(node)) {
      evidence.readsExternalValue = true;
      return evidence;
    }
    const callee = stripParenExpression(node.callee);
    const calleeRoot = getMemberRoot(callee);
    const isPureGlobalCall =
      (isNodeOfType(callee, "Identifier") &&
        PURE_GLOBAL_CALLEE_NAMES.has(callee.name) &&
        getIdentifierBindingIdentity(analysis, callee) === null) ||
      (isNodeOfType(calleeRoot, "Identifier") &&
        PURE_GLOBAL_NAMESPACE_NAMES.has(calleeRoot.name) &&
        getIdentifierBindingIdentity(analysis, calleeRoot) === null);
    const isPureMemberTransform =
      isNodeOfType(callee, "MemberExpression") &&
      PURE_MEMBER_TRANSFORM_NAMES.has(getStaticMemberName(callee) ?? "");
    if (isPureMemberTransform) {
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          callee.object as EsTreeNode,
          frame,
          remainingCallFrames,
          new Set(visitedBindings),
        ),
      );
    }
    for (const argument of node.arguments ?? []) {
      if (isFunctionLike(argument as EsTreeNode)) continue;
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          argument as EsTreeNode,
          frame,
          remainingCallFrames,
          new Set(visitedBindings),
        ),
      );
    }
    if (isPureGlobalCall || isPureMemberTransform) return evidence;
    if (isNodeOfType(callee, "MemberExpression")) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    if (remainingCallFrames <= 0) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const callable = resolveWrappedCallable(analysis, callee);
    if (
      !callable ||
      (callable as unknown as { async?: boolean }).async === true ||
      functionInvokesItself(analysis, callable)
    ) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const valueFrame: EffectExecutionFrame = {
      functionNode: callable,
      invocation: node,
      isDeferred: false,
      introducedBindings: new Set(),
      substitutions: buildSubstitutions(
        analysis,
        callable,
        (node.arguments ?? []) as ReadonlyArray<EsTreeNode>,
        frame,
      ),
    };
    const returnedExpressions = getReturnedExpressions(callable);
    if (returnedExpressions.length === 0) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    for (const returnedExpression of returnedExpressions) {
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          returnedExpression,
          valueFrame,
          remainingCallFrames - 1,
          new Set(visitedBindings),
        ),
      );
    }
    return evidence;
  }

  if (isFunctionLike(node) || isNodeOfType(node, "AwaitExpression")) {
    evidence.hasUnknownSource = true;
    return evidence;
  }

  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(nodeRecord)) {
    if (key === "parent" || key === "type" || key === "key") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (!child || typeof child !== "object" || !("type" in child)) continue;
        mergeEvidence(
          evidence,
          collectValueEvidence(
            analysis,
            child as EsTreeNode,
            frame,
            remainingCallFrames,
            new Set(visitedBindings),
          ),
        );
      }
    } else if (value && typeof value === "object" && "type" in value) {
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          value as EsTreeNode,
          frame,
          remainingCallFrames,
          new Set(visitedBindings),
        ),
      );
    }
  }
  return evidence;
};

const findStateSetterReference = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNode,
): Reference | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  if (!reference) return null;
  if (resolveToFunction(reference)) return null;
  if (isStateSetter(analysis, reference)) return reference;
  return (
    getUpstreamRefs(analysis, reference).find((upstreamReference) =>
      isStateSetter(analysis, upstreamReference),
    ) ?? null
  );
};

const isSameSimpleValue = (
  analysis: ProgramAnalysis,
  leftExpression: EsTreeNode,
  rightExpression: EsTreeNode,
): boolean => {
  const left = stripParenExpression(leftExpression);
  const right = stripParenExpression(rightExpression);
  if (left.type !== right.type) return false;
  if (isNodeOfType(left, "Identifier") && isNodeOfType(right, "Identifier")) {
    const leftBinding = getIdentifierBindingIdentity(analysis, left);
    const rightBinding = getIdentifierBindingIdentity(analysis, right);
    if (leftBinding || rightBinding) return leftBinding !== null && leftBinding === rightBinding;
    return left.name === right.name;
  }
  if (isNodeOfType(left, "Literal") && isNodeOfType(right, "Literal")) {
    return left.value === right.value;
  }
  if (isNodeOfType(left, "MemberExpression") && isNodeOfType(right, "MemberExpression")) {
    return (
      left.computed === right.computed &&
      isSameSimpleValue(analysis, left.object as EsTreeNode, right.object as EsTreeNode) &&
      isSameSimpleValue(analysis, left.property as EsTreeNode, right.property as EsTreeNode)
    );
  }
  return false;
};

const matchesStateInitializer = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNode,
  stateDeclarator: EsTreeNode,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  if (!isNodeOfType(stateDeclarator, "VariableDeclarator")) return false;
  if (!isNodeOfType(stateDeclarator.init, "CallExpression")) return false;
  const writtenValue = callExpression.arguments?.[0];
  const initializerValue = stateDeclarator.init.arguments?.[0];
  if (!writtenValue || !initializerValue) return false;
  const unwrappedInitializer = stripParenExpression(initializerValue as EsTreeNode);
  if (
    isNodeOfType(unwrappedInitializer, "LogicalExpression") &&
    (unwrappedInitializer.operator === "??" || unwrappedInitializer.operator === "||")
  ) {
    return (
      isSameSimpleValue(
        analysis,
        writtenValue as EsTreeNode,
        unwrappedInitializer.left as EsTreeNode,
      ) ||
      isSameSimpleValue(
        analysis,
        writtenValue as EsTreeNode,
        unwrappedInitializer.right as EsTreeNode,
      )
    );
  }
  return isSameSimpleValue(analysis, writtenValue as EsTreeNode, unwrappedInitializer);
};

const collectFrameSetterCalls = (
  analysis: ProgramAnalysis,
  frame: EffectExecutionFrame,
): ReadonlyArray<{ callExpression: EsTreeNode; setterReference: Reference }> => {
  const calls: Array<{ callExpression: EsTreeNode; setterReference: Reference }> = [];
  walkAst(frame.functionNode, (child: EsTreeNode): boolean | void => {
    if (child !== frame.functionNode && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const setterReference = findStateSetterReference(analysis, child);
    if (setterReference) calls.push({ callExpression: child, setterReference });
  });
  return calls;
};

const areInMutuallyExclusiveBranches = (leftNode: EsTreeNode, rightNode: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = leftNode.parent;
  while (ancestor) {
    if (
      (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
      ancestor.alternate
    ) {
      const leftIsConsequent = isAstDescendant(leftNode, ancestor.consequent as EsTreeNode);
      const leftIsAlternate = isAstDescendant(leftNode, ancestor.alternate as EsTreeNode);
      const rightIsConsequent = isAstDescendant(rightNode, ancestor.consequent as EsTreeNode);
      const rightIsAlternate = isAstDescendant(rightNode, ancestor.alternate as EsTreeNode);
      if ((leftIsConsequent && rightIsAlternate) || (leftIsAlternate && rightIsConsequent)) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const collectEffectStateWriteFacts = (
  analysis: ProgramAnalysis,
  effectNode: EsTreeNode,
): ReadonlyArray<EffectStateWriteFact> => {
  const frames = collectBoundedEffectExecutionFrames(analysis, effectNode);
  if (frames.length === 0) return [];
  const effectHasCleanup = hasCleanup(analysis, effectNode);
  const cleanupManagedStateDeclarators = new Set<EsTreeNode>();
  const facts: CollectedEffectStateWriteFact[] = [];

  for (const frame of frames) {
    for (const { callExpression, setterReference } of collectFrameSetterCalls(analysis, frame)) {
      if (!isNodeOfType(callExpression, "CallExpression")) continue;
      if ((callExpression.arguments ?? []).length !== 1) continue;
      const writtenValue = callExpression.arguments?.[0] as EsTreeNode | undefined;
      if (!writtenValue) continue;
      const stateDeclarator = getUseStateDecl(analysis, setterReference);
      if (!stateDeclarator) continue;
      const remainingValueCallFrames = frame === frames[0] ? 1 : 0;
      let valueEvidence: EffectValueEvidence;
      if (isFunctionLike(writtenValue)) {
        const updaterFrame: EffectExecutionFrame = {
          functionNode: writtenValue,
          invocation: callExpression,
          isDeferred: frame.isDeferred,
          introducedBindings: collectIntroducedBindings(analysis, writtenValue),
          substitutions: new Map(),
        };
        valueEvidence = emptyEvidence();
        const returnedExpressions = getReturnedExpressions(writtenValue);
        if (returnedExpressions.length === 0) valueEvidence.hasUnknownSource = true;
        for (const returnedExpression of returnedExpressions) {
          mergeEvidence(
            valueEvidence,
            collectValueEvidence(
              analysis,
              returnedExpression,
              updaterFrame,
              remainingValueCallFrames,
            ),
          );
        }
      } else {
        valueEvidence = collectValueEvidence(
          analysis,
          writtenValue,
          frame,
          remainingValueCallFrames,
        );
      }
      const sourceReferences = [...valueEvidence.sourceReferences].filter(
        (sourceReference) => getUseStateDecl(analysis, sourceReference) !== stateDeclarator,
      );
      const hasIndependentWriter = hasUserInputSetterWriter(setterReference, effectNode, true);
      const doesMatchStateInitializer = matchesStateInitializer(
        analysis,
        callExpression,
        stateDeclarator,
      );
      if (
        effectHasCleanup &&
        (frame.isDeferred ||
          valueEvidence.hasUnknownSource ||
          valueEvidence.hasDeferredIntroducedValue ||
          valueEvidence.readsExternalValue)
      ) {
        cleanupManagedStateDeclarators.add(stateDeclarator);
      }
      const isRenderKnownCopy =
        sourceReferences.length > 0 &&
        !frame.isDeferred &&
        !valueEvidence.hasUnknownSource &&
        !valueEvidence.hasDeferredIntroducedValue &&
        !valueEvidence.readsExternalValue &&
        !hasIndependentWriter;
      facts.push({
        callExpression,
        executionNode: frame.invocation ?? callExpression,
        setterReference,
        stateDeclarator,
        sourceReferences,
        isDeferred: frame.isDeferred,
        isRenderKnownCopy,
        matchesStateInitializer: doesMatchStateInitializer,
        resetsSourceState: false,
      });
    }
  }

  return facts.map((fact) => {
    const sourceStateDeclarators = fact.sourceReferences
      .filter((sourceReference) => isState(analysis, sourceReference))
      .map((sourceReference) => getUseStateDecl(analysis, sourceReference))
      .filter((declarator): declarator is EsTreeNode => Boolean(declarator));
    const resetsSourceState = sourceStateDeclarators.some((sourceDeclarator) =>
      facts.some(
        (candidateFact) =>
          !candidateFact.isDeferred &&
          candidateFact.stateDeclarator === sourceDeclarator &&
          !areInMutuallyExclusiveBranches(fact.executionNode, candidateFact.executionNode),
      ),
    );
    const { executionNode: _executionNode, ...publicFact } = fact;
    return {
      ...publicFact,
      resetsSourceState,
      isRenderKnownCopy:
        fact.isRenderKnownCopy &&
        !cleanupManagedStateDeclarators.has(fact.stateDeclarator) &&
        !resetsSourceState,
    };
  });
};
