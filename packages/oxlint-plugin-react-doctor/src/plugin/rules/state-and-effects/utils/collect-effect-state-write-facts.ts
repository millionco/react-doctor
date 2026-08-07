import type { Reference } from "eslint-scope";
import { collectEffectInvokedFunctions } from "../../../utils/collect-effect-invoked-functions.js";
import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import { collectPossibleAssignedExpressions } from "../../../utils/collect-possible-assigned-expressions.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { functionReturnsMatchingExpression } from "../../../utils/function-returns-matching-expression.js";
import { resolveImportedExportName } from "../../../utils/find-exported-function-body.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../../utils/has-static-property-write-before.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isEarlyExitIfStatement } from "../../../utils/is-early-exit-if-statement.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { isSynchronousIteratorCall } from "../../../utils/is-synchronous-iterator-callback.js";
import { readsPostMountValue } from "../../../utils/reads-post-mount-value.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { resolveCrossFileFunctionExport } from "../../../utils/resolve-cross-file-function-export.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkSynchronousCallbackFlow } from "../../../utils/walk-synchronous-callback-flow.js";
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
  currentFilename?: string;
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

export interface RenderValueEvidence {
  sourceReferences: ReadonlySet<Reference>;
  isExclusivelyRenderKnown: boolean;
}

interface HelperReturnSummary {
  usedParameterIndices: ReadonlySet<number>;
}

interface HelperSummaryEnvironment {
  parameterIndices: Map<string, ReadonlySet<number> | null>;
  recursiveNames: ReadonlySet<string>;
  shadowedGlobalNames: ReadonlySet<string>;
}

interface HelperControlFlowSummary {
  canContinue: boolean;
  isValid: boolean;
}

interface CollectedEffectStateWriteFact extends EffectStateWriteFact {
  executionNode: EsTreeNode;
}

export interface EffectStateWriteFact {
  callExpression: EsTreeNode;
  setterReference: Reference;
  stateDeclarator: EsTreeNode;
  sourceReferences: ReadonlyArray<Reference>;
  hasIndependentWriter: boolean;
  isDeferred: boolean;
  isRenderKnownCopy: boolean;
  isSynchronousRenderValue: boolean;
  matchesStateInitializer: boolean;
  readsWrittenState: boolean;
  resetsSourceState: boolean;
  writtenIndexedMemberRootReference: Reference | null;
  writesPropDerivedMemberValue: boolean;
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
  "encodeURIComponent",
  "Number",
  "Object",
  "String",
  "parseFloat",
  "parseInt",
  "structuredClone",
]);

const PURE_GLOBAL_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set(["Date", "Set"]);

const PURE_HELPER_NAMESPACE_MEMBER_NAMES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Array", new Set(["from"])],
  ["JSON", new Set(["isRawJSON", "parse", "rawJSON", "stringify"])],
  [
    "Math",
    new Set([
      "abs",
      "acos",
      "acosh",
      "asin",
      "asinh",
      "atan",
      "atan2",
      "atanh",
      "cbrt",
      "ceil",
      "clz32",
      "cos",
      "cosh",
      "exp",
      "floor",
      "fround",
      "hypot",
      "imul",
      "log",
      "log10",
      "log1p",
      "log2",
      "max",
      "min",
      "pow",
      "round",
      "sign",
      "sin",
      "sinh",
      "sqrt",
      "tan",
      "tanh",
      "trunc",
    ]),
  ],
  ["Object", new Set(["assign"])],
]);

const PURE_MEMBER_TRANSFORM_NAMES: ReadonlySet<string> = new Set([
  "concat",
  "filter",
  "flatMap",
  "join",
  "map",
  "reduce",
  "replace",
  "slice",
  "split",
  "toLowerCase",
  "toString",
  "toSorted",
  "toUpperCase",
  "trim",
]);

const FRESH_ARRAY_COPY_METHOD_NAMES: ReadonlySet<string> = new Set([
  "concat",
  "filter",
  "flatMap",
  "map",
  "slice",
  "split",
  "toSorted",
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

const isFreshArrayCopyExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ArrayExpression")) return true;
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  const callee = stripParenExpression(candidate.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    FRESH_ARRAY_COPY_METHOD_NAMES.has(getStaticMemberName(callee) ?? "")
  );
};

const isCopyFirstSortCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  getStaticMemberName(callee) === "sort" &&
  isFreshArrayCopyExpression(callee.object as EsTreeNode);

const isDirectDateGetTimeCallee = (callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (getStaticMemberName(callee) !== "getTime") return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  return (
    isNodeOfType(receiver, "NewExpression") &&
    isNodeOfType(receiver.callee, "Identifier") &&
    receiver.callee.name === "Date" &&
    (receiver.arguments ?? []).length > 0
  );
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

const isAsyncOrGeneratorFunction = (functionNode: EsTreeNode): boolean =>
  Boolean(
    (functionNode as unknown as { async?: boolean }).async === true ||
    (functionNode as unknown as { generator?: boolean }).generator === true,
  );

const isModuleFunction = (functionNode: EsTreeNode): boolean => {
  let ancestor = functionNode.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return false;
    if (isNodeOfType(ancestor, "Program")) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const getFunctionBindingNames = (functionNode: EsTreeNode): ReadonlySet<string> => {
  const names = new Set<string>();
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    names.add(functionNode.id.name);
  }
  const parent = functionNode.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    names.add(parent.id.name);
  }
  return names;
};

const collectModuleBindingNames = (functionNode: EsTreeNode): ReadonlySet<string> => {
  let program = functionNode.parent;
  while (program && !isNodeOfType(program, "Program")) program = program.parent;
  const bindingNames = new Set<string>();
  if (!program || !isNodeOfType(program, "Program")) return bindingNames;
  for (const statement of program.body ?? []) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      for (const specifier of statement.specifiers ?? []) {
        if (isNodeOfType(specifier.local, "Identifier")) bindingNames.add(specifier.local.name);
      }
      continue;
    }
    const declaration =
      isNodeOfType(statement, "ExportNamedDeclaration") ||
      isNodeOfType(statement, "ExportDefaultDeclaration")
        ? statement.declaration
        : statement;
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations ?? []) {
        collectPatternNames(declarator.id, bindingNames);
      }
      continue;
    }
    if (
      (isNodeOfType(declaration, "FunctionDeclaration") ||
        isNodeOfType(declaration, "ClassDeclaration")) &&
      isNodeOfType(declaration.id, "Identifier")
    ) {
      bindingNames.add(declaration.id.name);
    }
  }
  return bindingNames;
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
    if (reference.resolved?.defs.some((definition) => definition.type === "ImportBinding")) {
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
  currentFilename?: string,
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
    currentFilename,
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
        currentFilename,
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

const analyzeHelperStatements = (
  statements: ReadonlyArray<EsTreeNode>,
  environment: HelperSummaryEnvironment,
  usedParameterIndices: Set<number>,
  analyzeExpression: (
    expression: EsTreeNode,
    expressionEnvironment: HelperSummaryEnvironment,
    expressionUsedParameterIndices: Set<number>,
  ) => boolean,
): HelperControlFlowSummary => {
  const localEnvironment: HelperSummaryEnvironment = {
    ...environment,
    parameterIndices: new Map(environment.parameterIndices),
  };
  let canContinue = true;
  for (const statement of statements) {
    if (!canContinue) {
      if (!isNodeOfType(statement, "EmptyStatement")) {
        return { canContinue: false, isValid: false };
      }
      continue;
    }
    if (isNodeOfType(statement, "EmptyStatement")) continue;
    if (isNodeOfType(statement, "VariableDeclaration")) {
      if (statement.kind !== "const") return { canContinue: false, isValid: false };
      for (const declaration of statement.declarations ?? []) {
        const initializerParameterIndices = new Set<number>();
        if (
          !isNodeOfType(declaration.id, "Identifier") ||
          !declaration.init ||
          !analyzeExpression(
            declaration.init as EsTreeNode,
            localEnvironment,
            initializerParameterIndices,
          )
        ) {
          return { canContinue: false, isValid: false };
        }
        localEnvironment.parameterIndices.set(declaration.id.name, initializerParameterIndices);
      }
      continue;
    }
    if (isNodeOfType(statement, "ReturnStatement")) {
      if (
        !statement.argument ||
        !analyzeExpression(statement.argument as EsTreeNode, localEnvironment, usedParameterIndices)
      ) {
        return { canContinue: false, isValid: false };
      }
      canContinue = false;
      continue;
    }
    if (isNodeOfType(statement, "BlockStatement")) {
      const blockSummary = analyzeHelperStatements(
        (statement.body ?? []) as ReadonlyArray<EsTreeNode>,
        localEnvironment,
        usedParameterIndices,
        analyzeExpression,
      );
      if (!blockSummary.isValid) return blockSummary;
      canContinue = blockSummary.canContinue;
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      if (
        !analyzeExpression(statement.test as EsTreeNode, localEnvironment, usedParameterIndices)
      ) {
        return { canContinue: false, isValid: false };
      }
      const consequentSummary = analyzeHelperStatements(
        [statement.consequent as EsTreeNode],
        localEnvironment,
        usedParameterIndices,
        analyzeExpression,
      );
      if (!consequentSummary.isValid) return consequentSummary;
      const alternateSummary = statement.alternate
        ? analyzeHelperStatements(
            [statement.alternate as EsTreeNode],
            localEnvironment,
            usedParameterIndices,
            analyzeExpression,
          )
        : { canContinue: true, isValid: true };
      if (!alternateSummary.isValid) return alternateSummary;
      canContinue = consequentSummary.canContinue || alternateSummary.canContinue;
      continue;
    }
    return { canContinue: false, isValid: false };
  }
  return { canContinue, isValid: true };
};

const analyzeHelperExpression = (
  expression: EsTreeNode,
  environment: HelperSummaryEnvironment,
  usedParameterIndices: Set<number>,
): boolean => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal") || isNodeOfType(node, "TemplateElement")) {
    return true;
  }
  if (isNodeOfType(node, "Identifier")) {
    const referencedParameterIndices = environment.parameterIndices.get(node.name);
    if (referencedParameterIndices !== undefined) {
      if (referencedParameterIndices !== null) {
        for (const parameterIndex of referencedParameterIndices) {
          usedParameterIndices.add(parameterIndex);
        }
      }
      return true;
    }
    return node.name === "undefined" || node.name === "NaN" || node.name === "Infinity";
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    return (node.elements ?? []).every(
      (element) =>
        !element ||
        analyzeHelperExpression(element as EsTreeNode, environment, usedParameterIndices),
    );
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    return (node.properties ?? []).every((property) => {
      if (isNodeOfType(property, "SpreadElement")) {
        return analyzeHelperExpression(
          property.argument as EsTreeNode,
          environment,
          usedParameterIndices,
        );
      }
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.method === true
      ) {
        return false;
      }
      if (
        property.computed &&
        !analyzeHelperExpression(property.key as EsTreeNode, environment, usedParameterIndices)
      ) {
        return false;
      }
      return analyzeHelperExpression(
        property.value as EsTreeNode,
        environment,
        usedParameterIndices,
      );
    });
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.expressions ?? []).every((templateExpression) =>
      analyzeHelperExpression(templateExpression as EsTreeNode, environment, usedParameterIndices),
    );
  }
  if (isNodeOfType(node, "UnaryExpression")) {
    return (
      node.operator !== "delete" &&
      analyzeHelperExpression(node.argument as EsTreeNode, environment, usedParameterIndices)
    );
  }
  if (isNodeOfType(node, "BinaryExpression") || isNodeOfType(node, "LogicalExpression")) {
    return (
      analyzeHelperExpression(node.left as EsTreeNode, environment, usedParameterIndices) &&
      analyzeHelperExpression(node.right as EsTreeNode, environment, usedParameterIndices)
    );
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      analyzeHelperExpression(node.test as EsTreeNode, environment, usedParameterIndices) &&
      analyzeHelperExpression(node.consequent as EsTreeNode, environment, usedParameterIndices) &&
      analyzeHelperExpression(node.alternate as EsTreeNode, environment, usedParameterIndices)
    );
  }
  if (isNodeOfType(node, "MemberExpression")) {
    if (!analyzeHelperExpression(node.object as EsTreeNode, environment, usedParameterIndices)) {
      return false;
    }
    return (
      !node.computed ||
      analyzeHelperExpression(node.property as EsTreeNode, environment, usedParameterIndices)
    );
  }
  if (isFunctionLike(node)) {
    if (isAsyncOrGeneratorFunction(node)) return false;
    const callbackParameterIndices = new Map(environment.parameterIndices);
    for (const parameter of getFunctionParameters(node)) {
      if (!isNodeOfType(parameter, "Identifier")) return false;
      callbackParameterIndices.set(parameter.name, null);
    }
    const callbackEnvironment: HelperSummaryEnvironment = {
      parameterIndices: callbackParameterIndices,
      recursiveNames: environment.recursiveNames,
      shadowedGlobalNames: environment.shadowedGlobalNames,
    };
    if (!isNodeOfType(node.body, "BlockStatement")) {
      return analyzeHelperExpression(
        node.body as EsTreeNode,
        callbackEnvironment,
        usedParameterIndices,
      );
    }
    const callbackSummary = analyzeHelperStatements(
      (node.body.body ?? []) as ReadonlyArray<EsTreeNode>,
      callbackEnvironment,
      usedParameterIndices,
      analyzeHelperExpression,
    );
    return callbackSummary.isValid && !callbackSummary.canContinue;
  }
  if (isNodeOfType(node, "NewExpression")) {
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      !PURE_GLOBAL_CONSTRUCTOR_NAMES.has(callee.name) ||
      environment.parameterIndices.has(callee.name) ||
      environment.recursiveNames.has(callee.name) ||
      environment.shadowedGlobalNames.has(callee.name)
    ) {
      return false;
    }
    return (node.arguments ?? []).every((argument) =>
      analyzeHelperExpression(argument as EsTreeNode, environment, usedParameterIndices),
    );
  }
  if (isNodeOfType(node, "CallExpression")) {
    const callee = stripParenExpression(node.callee);
    const calleeRoot = getMemberRoot(callee);
    const isPureGlobalCall =
      isNodeOfType(callee, "Identifier") &&
      PURE_GLOBAL_CALLEE_NAMES.has(callee.name) &&
      !environment.parameterIndices.has(callee.name) &&
      !environment.recursiveNames.has(callee.name) &&
      !environment.shadowedGlobalNames.has(callee.name);
    const namespaceName =
      isNodeOfType(calleeRoot, "Identifier") &&
      !environment.parameterIndices.has(calleeRoot.name) &&
      !environment.recursiveNames.has(calleeRoot.name) &&
      !environment.shadowedGlobalNames.has(calleeRoot.name)
        ? calleeRoot.name
        : null;
    const namespaceMemberName = getStaticMemberName(callee);
    const isPureNamespaceCall =
      isNodeOfType(callee, "MemberExpression") &&
      namespaceName !== null &&
      namespaceMemberName !== null &&
      PURE_HELPER_NAMESPACE_MEMBER_NAMES.get(namespaceName)?.has(namespaceMemberName) === true;
    const isPureMemberTransform =
      isNodeOfType(callee, "MemberExpression") &&
      PURE_MEMBER_TRANSFORM_NAMES.has(getStaticMemberName(callee) ?? "");
    const isCopyFirstSort = isCopyFirstSortCallee(callee);
    const isDirectDateGetTime = isDirectDateGetTimeCallee(callee);
    if (
      !isPureGlobalCall &&
      !isPureNamespaceCall &&
      !isPureMemberTransform &&
      !isCopyFirstSort &&
      !isDirectDateGetTime
    ) {
      return false;
    }
    if (
      (isPureMemberTransform || isCopyFirstSort || isDirectDateGetTime) &&
      isNodeOfType(callee, "MemberExpression") &&
      !analyzeHelperExpression(callee.object as EsTreeNode, environment, usedParameterIndices)
    ) {
      return false;
    }
    return (node.arguments ?? []).every((argument) =>
      analyzeHelperExpression(argument as EsTreeNode, environment, usedParameterIndices),
    );
  }
  if (isNodeOfType(node, "SpreadElement")) {
    return analyzeHelperExpression(node.argument as EsTreeNode, environment, usedParameterIndices);
  }
  return false;
};

const helperSummaryCache = new WeakMap<EsTreeNode, HelperReturnSummary | null>();

const summarizeHelperReturn = (functionNode: EsTreeNode): HelperReturnSummary | null => {
  if (!isFunctionLike(functionNode) || !isModuleFunction(functionNode)) return null;
  if (helperSummaryCache.has(functionNode)) return helperSummaryCache.get(functionNode) ?? null;
  if (isAsyncOrGeneratorFunction(functionNode)) {
    helperSummaryCache.set(functionNode, null);
    return null;
  }
  const parameterIndices = new Map<string, ReadonlySet<number> | null>();
  const parameters = getFunctionParameters(functionNode);
  for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
    const parameter = parameters[parameterIndex];
    if (
      !parameter ||
      !isNodeOfType(parameter, "Identifier") ||
      parameterIndices.has(parameter.name)
    ) {
      helperSummaryCache.set(functionNode, null);
      return null;
    }
    parameterIndices.set(parameter.name, new Set([parameterIndex]));
  }
  const environment: HelperSummaryEnvironment = {
    parameterIndices,
    recursiveNames: getFunctionBindingNames(functionNode),
    shadowedGlobalNames: collectModuleBindingNames(functionNode),
  };
  const usedParameterIndices = new Set<number>();
  if (!isNodeOfType(functionNode.body, "BlockStatement")) {
    if (
      !analyzeHelperExpression(functionNode.body as EsTreeNode, environment, usedParameterIndices)
    ) {
      helperSummaryCache.set(functionNode, null);
      return null;
    }
  } else {
    const controlFlowSummary = analyzeHelperStatements(
      (functionNode.body.body ?? []) as ReadonlyArray<EsTreeNode>,
      environment,
      usedParameterIndices,
      analyzeHelperExpression,
    );
    if (!controlFlowSummary.isValid || controlFlowSummary.canContinue) {
      helperSummaryCache.set(functionNode, null);
      return null;
    }
  }
  const summary: HelperReturnSummary = { usedParameterIndices };
  helperSummaryCache.set(functionNode, summary);
  return summary;
};

const resolveValueHelperFunction = (
  analysis: ProgramAnalysis,
  callee: EsTreeNode,
  currentFilename: string | undefined,
): EsTreeNode | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  if (!reference?.resolved) return null;
  const importDefinition = reference.resolved.defs.find(
    (definition) => definition.type === "ImportBinding",
  );
  if (importDefinition) {
    if (!currentFilename) return null;
    const specifier = importDefinition.node as unknown as EsTreeNode;
    if (
      !isNodeOfType(specifier, "ImportSpecifier") &&
      !isNodeOfType(specifier, "ImportDefaultSpecifier")
    ) {
      return null;
    }
    const importDeclaration = specifier.parent;
    if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
    if (
      importDeclaration.importKind === "type" ||
      (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
    ) {
      return null;
    }
    const source = importDeclaration.source?.value;
    if (typeof source !== "string") return null;
    const exportedName = resolveImportedExportName(specifier);
    if (!exportedName) return null;
    return resolveCrossFileFunctionExport(currentFilename, source, exportedName);
  }
  const callable = resolveWrappedCallable(analysis, callee);
  return callable && isModuleFunction(callable) ? callable : null;
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

const getUseRefDeclarator = (
  analysis: ProgramAnalysis,
  memberExpression: EsTreeNode,
): EsTreeNode | null => {
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    getStaticMemberName(memberExpression) !== "current" ||
    !isNodeOfType(memberExpression.object, "Identifier")
  ) {
    return null;
  }
  const objectReference = getRef(analysis, memberExpression.object);
  return (
    objectReference?.resolved?.defs
      .map((definition) => definition.node as unknown as EsTreeNode)
      .find(
        (definitionNode) =>
          isNodeOfType(definitionNode, "VariableDeclarator") &&
          isNodeOfType(definitionNode.init, "CallExpression") &&
          getCallCalleeName(definitionNode.init) === "useRef",
      ) ?? null
  );
};

const collectValueEvidence = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  frame: EffectExecutionFrame,
  remainingCallFrames: number,
  visitedBindings: Set<unknown> = new Set(),
): EffectValueEvidence => {
  const node = stripParenExpression(expression);
  const evidence = emptyEvidence();
  const useRefDeclarator = getUseRefDeclarator(analysis, node);

  if (
    !useRefDeclarator &&
    (readsPostMountValue(node) || readsPostMountValueThroughLocals(node, frame.functionNode))
  ) {
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
    const nonInitializerWrites = reference.resolved.references.filter(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    );
    if (nonInitializerWrites.length > 0) {
      const writtenIdentifier = nonInitializerWrites[0]?.identifier as unknown as EsTreeNode;
      const assignment = writtenIdentifier.parent;
      if (
        nonInitializerWrites.length === 1 &&
        assignment &&
        isNodeOfType(assignment, "AssignmentExpression") &&
        assignment.operator === "=" &&
        assignment.left === writtenIdentifier
      ) {
        return collectValueEvidence(
          analysis,
          assignment.right as EsTreeNode,
          frame,
          remainingCallFrames,
          visitedBindings,
        );
      }
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
    if (getStaticMemberName(node) === "current" && isNodeOfType(node.object, "Identifier")) {
      const objectReference = getRef(analysis, node.object);
      const refBinding = objectReference?.resolved;
      const refDeclarator = useRefDeclarator;
      if (
        refBinding &&
        refDeclarator &&
        isNodeOfType(refDeclarator, "VariableDeclarator") &&
        isNodeOfType(refDeclarator.init, "CallExpression")
      ) {
        if (visitedBindings.has(refBinding)) {
          evidence.hasUnknownSource = true;
          return evidence;
        }
        const refVisitedBindings = new Set(visitedBindings);
        refVisitedBindings.add(refBinding);
        const initialValue = refDeclarator.init.arguments?.[0];
        if (initialValue) {
          mergeEvidence(
            evidence,
            collectValueEvidence(
              analysis,
              initialValue as EsTreeNode,
              frame,
              remainingCallFrames,
              new Set(refVisitedBindings),
            ),
          );
        }
        for (const candidateReference of refBinding.references) {
          if (candidateReference.init) continue;
          const identifier = candidateReference.identifier as unknown as EsTreeNode;
          const member = identifier.parent;
          if (
            !member ||
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== identifier ||
            getStaticMemberName(member) !== "current"
          ) {
            evidence.hasUnknownSource = true;
            continue;
          }
          const memberParent = member.parent;
          if (
            memberParent &&
            isNodeOfType(memberParent, "AssignmentExpression") &&
            memberParent.left === member
          ) {
            if (memberParent.operator !== "=") {
              evidence.hasUnknownSource = true;
              continue;
            }
            mergeEvidence(
              evidence,
              collectValueEvidence(
                analysis,
                memberParent.right as EsTreeNode,
                frame,
                remainingCallFrames,
                new Set(refVisitedBindings),
              ),
            );
            continue;
          }
          if (memberParent && isNodeOfType(memberParent, "UpdateExpression")) {
            evidence.hasUnknownSource = true;
          }
        }
        return evidence;
      }
    }
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
      (isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(calleeRoot, "Identifier") &&
        getIdentifierBindingIdentity(analysis, calleeRoot) === null &&
        PURE_HELPER_NAMESPACE_MEMBER_NAMES.get(calleeRoot.name)?.has(
          getStaticMemberName(callee) ?? "",
        ) === true);
    const isPureMemberTransform =
      isNodeOfType(callee, "MemberExpression") &&
      PURE_MEMBER_TRANSFORM_NAMES.has(getStaticMemberName(callee) ?? "");
    if (isPureGlobalCall || isPureMemberTransform) {
      if (isPureMemberTransform && isNodeOfType(callee, "MemberExpression")) {
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
      return evidence;
    }
    if (remainingCallFrames <= 0) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const localHelperFunction = resolveWrappedCallable(analysis, callee);
    if (localHelperFunction && !isModuleFunction(localHelperFunction)) {
      if (
        isAsyncOrGeneratorFunction(localHelperFunction) ||
        functionInvokesItself(analysis, localHelperFunction)
      ) {
        evidence.hasUnknownSource = true;
        return evidence;
      }
      const localHelperFrame: EffectExecutionFrame = {
        functionNode: localHelperFunction,
        invocation: node,
        isDeferred: false,
        introducedBindings: new Set(),
        substitutions: buildSubstitutions(
          analysis,
          localHelperFunction,
          (node.arguments ?? []) as ReadonlyArray<EsTreeNode>,
          frame,
        ),
        currentFilename: frame.currentFilename,
      };
      const returnedExpressions = getReturnedExpressions(localHelperFunction);
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
            localHelperFrame,
            remainingCallFrames - 1,
            new Set(visitedBindings),
          ),
        );
      }
      return evidence;
    }
    const helperFunction = resolveValueHelperFunction(analysis, callee, frame.currentFilename);
    const helperSummary = helperFunction ? summarizeHelperReturn(helperFunction) : null;
    if (!helperSummary) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    const argumentsForHelper = (node.arguments ?? []) as ReadonlyArray<EsTreeNode>;
    for (const parameterIndex of helperSummary.usedParameterIndices) {
      const argument = argumentsForHelper[parameterIndex];
      if (!argument) {
        evidence.hasUnknownSource = true;
        return evidence;
      }
      mergeEvidence(
        evidence,
        collectValueEvidence(
          analysis,
          argument,
          frame,
          remainingCallFrames - 1,
          new Set(visitedBindings),
        ),
      );
    }
    return evidence;
  }

  if (isNodeOfType(node, "NewExpression")) {
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      !PURE_GLOBAL_CONSTRUCTOR_NAMES.has(callee.name) ||
      getIdentifierBindingIdentity(analysis, callee) !== null
    ) {
      evidence.hasUnknownSource = true;
      return evidence;
    }
    for (const argument of node.arguments ?? []) {
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

export const collectRenderValueEvidence = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  componentFunction: EsTreeNode,
  currentFilename?: string,
): RenderValueEvidence => {
  const evidence = collectValueEvidence(
    analysis,
    expression,
    {
      functionNode: componentFunction,
      invocation: null,
      isDeferred: false,
      introducedBindings: new Set(),
      substitutions: new Map(),
      currentFilename,
    },
    1,
  );
  return {
    sourceReferences: evidence.sourceReferences,
    isExclusivelyRenderKnown:
      evidence.sourceReferences.size > 0 &&
      !evidence.hasUnknownSource &&
      !evidence.hasDeferredIntroducedValue &&
      !evidence.readsExternalValue,
  };
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
  if (!writtenValue) return false;
  if (!initializerValue) {
    const unwrappedWrittenValue = stripParenExpression(writtenValue as EsTreeNode);
    return (
      isNodeOfType(unwrappedWrittenValue, "Identifier") &&
      unwrappedWrittenValue.name === "undefined" &&
      !getRef(analysis, unwrappedWrittenValue)?.resolved
    );
  }
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

const writesPropDerivedMemberValue = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  frame: EffectExecutionFrame,
  visitedBindings: ReadonlySet<unknown> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const reference = getRef(analysis, candidate);
    const bindingIdentity = reference?.resolved ?? candidate;
    if (visitedBindings.has(bindingIdentity)) return false;
    const substitution = frame.substitutions.get(bindingIdentity);
    return substitution
      ? writesPropDerivedMemberValue(
          analysis,
          substitution.expression,
          substitution.frame,
          new Set(visitedBindings).add(bindingIdentity),
        )
      : false;
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return false;
  let root = stripParenExpression(candidate.object as EsTreeNode);
  while (isNodeOfType(root, "MemberExpression")) {
    root = stripParenExpression(root.object as EsTreeNode);
  }
  if (!isNodeOfType(root, "Identifier")) return false;
  const reference = getRef(analysis, root);
  if (!reference) return false;
  const bindingIdentity = reference.resolved ?? root;
  if (visitedBindings.has(bindingIdentity)) return false;
  const substitution = frame.substitutions.get(bindingIdentity);
  if (substitution) {
    return writesPropDerivedMemberValue(
      analysis,
      substitution.expression,
      substitution.frame,
      new Set(visitedBindings).add(bindingIdentity),
    );
  }
  return getUpstreamRefs(analysis, reference).some((upstreamReference) =>
    isProp(analysis, upstreamReference),
  );
};

const getWrittenIndexedMemberRootReference = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  frame: EffectExecutionFrame,
  hasIndexedAccess = false,
  visitedBindings: ReadonlySet<unknown> = new Set(),
): Reference | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const reference = getRef(analysis, candidate);
    const bindingIdentity = reference?.resolved ?? candidate;
    if (visitedBindings.has(bindingIdentity)) return null;
    const substitution = frame.substitutions.get(bindingIdentity);
    return substitution
      ? getWrittenIndexedMemberRootReference(
          analysis,
          substitution.expression,
          substitution.frame,
          hasIndexedAccess,
          new Set(visitedBindings).add(bindingIdentity),
        )
      : hasIndexedAccess
        ? reference
        : null;
  }
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const isIndexedAccess =
    candidate.computed &&
    isNodeOfType(candidate.property, "Literal") &&
    typeof candidate.property.value === "number";
  return getWrittenIndexedMemberRootReference(
    analysis,
    candidate.object as EsTreeNode,
    frame,
    hasIndexedAccess || isIndexedAccess,
    visitedBindings,
  );
};

const getFunctionalUpdaterIndexedMemberRootReference = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  updater: EsTreeNode,
  frame: EffectExecutionFrame,
): Reference | null => {
  const currentStateParameter = getFunctionParameters(updater)[0];
  if (!currentStateParameter || !isNodeOfType(currentStateParameter, "Identifier")) return null;
  const currentStateParameterSymbol = context.scopes.symbolFor(currentStateParameter);
  if (!currentStateParameterSymbol) return null;
  let indexedMemberRootReference: Reference | null = null;
  const areAllReturnsCompatible = functionReturnsMatchingExpression(
    updater,
    context.scopes,
    (returnedExpression) => {
      const candidate = stripParenExpression(returnedExpression);
      if (
        isNodeOfType(candidate, "Identifier") &&
        context.scopes.symbolFor(candidate) === currentStateParameterSymbol
      ) {
        return true;
      }
      const returnedRootReference = getWrittenIndexedMemberRootReference(
        analysis,
        candidate,
        frame,
      );
      if (!returnedRootReference?.resolved) return false;
      if (
        indexedMemberRootReference &&
        indexedMemberRootReference.resolved !== returnedRootReference.resolved
      ) {
        return false;
      }
      indexedMemberRootReference = returnedRootReference;
      return true;
    },
    context.cfg,
    "every",
  );
  return areAllReturnsCompatible ? indexedMemberRootReference : null;
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

const expressionReadsStateDeclarator = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  frame: EffectExecutionFrame,
  expression: EsTreeNode,
  stateDeclarator: EsTreeNode,
): boolean => {
  const isUnmodifiedMemberCall = (
    callExpression: EsTreeNode,
    executionReferenceNode: EsTreeNode = callExpression,
  ): boolean => {
    if (!isNodeOfType(callExpression, "CallExpression")) return false;
    const callee = stripParenExpression(callExpression.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const methodName = getStaticMemberName(callee);
    if (!methodName) return false;
    const receiver = stripParenExpression(callee.object);
    const hasPropertyWriteBefore = (referenceNode: EsTreeNode): boolean =>
      isNodeOfType(receiver, "Identifier") &&
      hasPossibleStaticPropertyWriteBefore(receiver, methodName, referenceNode, context.scopes);
    return Boolean(
      !isNodeOfType(receiver, "Identifier") ||
      (!hasPropertyWriteBefore(callExpression) && !hasPropertyWriteBefore(executionReferenceNode)),
    );
  };
  const isRenderPropCollectionReference = (candidateExpression: EsTreeNode): boolean => {
    const candidate = stripParenExpression(candidateExpression);
    if (!isNodeOfType(candidate, "Identifier")) return false;
    const reference = getRef(analysis, candidate);
    return Boolean(reference && isProp(analysis, reference));
  };
  const isProvenRenderKnownArrayValue = (
    candidateExpression: EsTreeNode,
    visitedSymbolIds: ReadonlySet<number> = new Set(),
    executionReferenceNode: EsTreeNode = candidateExpression,
  ): boolean => {
    const candidate = stripParenExpression(candidateExpression);
    if (isNodeOfType(candidate, "ArrayExpression")) return candidate.elements.length > 0;
    if (isNodeOfType(candidate, "Identifier")) {
      const symbol = context.scopes.symbolFor(candidate);
      if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
      const assignedExpressions = collectPossibleAssignedExpressions(
        symbol,
        candidate,
        context.cfg,
      );
      if (assignedExpressions.length === 0) return false;
      const nextVisitedSymbolIds = new Set(visitedSymbolIds).add(symbol.id);
      let hasArraySource = false;
      for (const assignedExpression of assignedExpressions) {
        const assignedCandidate = stripParenExpression(assignedExpression);
        const assignedCallee = isNodeOfType(assignedCandidate, "CallExpression")
          ? stripParenExpression(assignedCandidate.callee)
          : null;
        if (
          assignedCallee &&
          isNodeOfType(assignedCallee, "MemberExpression") &&
          FRESH_ARRAY_COPY_METHOD_NAMES.has(getStaticMemberName(assignedCallee) ?? "") &&
          isNodeOfType(assignedCallee.object, "Identifier") &&
          context.scopes.symbolFor(assignedCallee.object) === symbol
        ) {
          if (!isUnmodifiedMemberCall(assignedCandidate, executionReferenceNode)) return false;
          continue;
        }
        if (
          !isProvenRenderKnownArrayValue(
            assignedCandidate,
            nextVisitedSymbolIds,
            executionReferenceNode,
          )
        ) {
          return false;
        }
        hasArraySource = true;
      }
      return (
        hasArraySource ||
        Boolean(
          symbol.initializer &&
          isProvenRenderKnownArrayValue(
            symbol.initializer,
            nextVisitedSymbolIds,
            executionReferenceNode,
          ),
        )
      );
    }
    if (!isNodeOfType(candidate, "CallExpression")) return false;
    if (isReactHookCall(candidate, "useMemo", context.scopes)) {
      const factoryArgument = candidate.arguments?.[0];
      const factory =
        factoryArgument && !isNodeOfType(factoryArgument, "SpreadElement")
          ? resolveWrappedCallable(analysis, factoryArgument)
          : null;
      return Boolean(
        factory &&
        !isAsyncOrGeneratorFunction(factory) &&
        functionReturnsMatchingExpression(
          factory,
          context.scopes,
          (returnedExpression) =>
            isProvenRenderKnownArrayValue(returnedExpression, visitedSymbolIds, candidate),
          context.cfg,
          "every",
        ),
      );
    }
    const callee = stripParenExpression(candidate.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isUnmodifiedMemberCall(candidate, executionReferenceNode)
    ) {
      return false;
    }
    const methodName = getStaticMemberName(callee);
    return Boolean(
      methodName &&
      FRESH_ARRAY_COPY_METHOD_NAMES.has(methodName) &&
      (isProvenRenderKnownArrayValue(callee.object, visitedSymbolIds, executionReferenceNode) ||
        (methodName === "filter" && isRenderPropCollectionReference(callee.object))),
    );
  };
  const isProvenMemoizedArrayReceiver = (
    receiverExpression: EsTreeNode,
    visitedSymbolIds: ReadonlySet<number> = new Set(),
  ): boolean => {
    const receiver = stripParenExpression(receiverExpression);
    if (isNodeOfType(receiver, "CallExpression")) {
      return (
        isReactHookCall(receiver, "useMemo", context.scopes) &&
        isProvenRenderKnownArrayValue(receiver, visitedSymbolIds)
      );
    }
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(receiver);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const assignedExpressions = collectPossibleAssignedExpressions(symbol, receiver, context.cfg);
    if (assignedExpressions.length === 0) return false;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds).add(symbol.id);
    return assignedExpressions.every((assignedExpression) =>
      isProvenMemoizedArrayReceiver(assignedExpression, nextVisitedSymbolIds),
    );
  };
  let readsState = false;
  walkSynchronousCallbackFlow(
    expression,
    (child: EsTreeNode): void => {
      if (readsState) return;
      if (isNodeOfType(child, "MemberExpression") && getStaticMemberName(child) === "current") {
        const valueEvidence = collectValueEvidence(analysis, child, frame, 1);
        const sourceStateDeclarators = [...valueEvidence.sourceReferences]
          .filter((reference) => isState(analysis, reference))
          .map((reference) => getUseStateDecl(analysis, reference));
        if (
          sourceStateDeclarators.length > 0 &&
          sourceStateDeclarators.every((declarator) => declarator === stateDeclarator) &&
          !valueEvidence.hasUnknownSource &&
          !valueEvidence.hasDeferredIntroducedValue &&
          !valueEvidence.readsExternalValue
        ) {
          readsState = true;
        }
        return;
      }
      if (!isNodeOfType(child, "Identifier")) return;
      const reference = getRef(analysis, child);
      if (
        reference?.isRead() &&
        isState(analysis, reference) &&
        getUseStateDecl(analysis, reference) === stateDeclarator &&
        isNodeReachableWithinFunction(child, context)
      ) {
        readsState = true;
      }
    },
    (callExpression, callbackArgument) => {
      if (!isUnmodifiedMemberCall(callExpression)) return false;
      if (isSynchronousIteratorCall(callExpression, callbackArgument, context.scopes)) return true;
      const callee = stripParenExpression(callExpression.callee);
      return Boolean(
        callExpression.arguments[0] === callbackArgument &&
        isNodeOfType(callee, "MemberExpression") &&
        SYNCHRONOUS_ITERATOR_METHOD_NAMES.has(getStaticMemberName(callee) ?? "") &&
        isProvenMemoizedArrayReceiver(callee.object),
      );
    },
    (functionNode) => !isAsyncOrGeneratorFunction(functionNode),
  );
  return readsState;
};

const functionalUpdaterReadsCurrentState = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNode,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const updater = callExpression.arguments?.[0] as EsTreeNode | undefined;
  if (!updater || !isFunctionLike(updater)) return false;
  const currentStateParameter = getFunctionParameters(updater)[0];
  if (!currentStateParameter || !isNodeOfType(currentStateParameter, "Identifier")) return false;
  let readsCurrentState = false;
  walkAst(updater.body as EsTreeNode, (child: EsTreeNode): boolean | void => {
    if (readsCurrentState) return false;
    if (child !== updater.body && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "Identifier") &&
      child.name === currentStateParameter.name &&
      getRef(analysis, child)?.resolved?.identifiers.includes(currentStateParameter as never)
    ) {
      readsCurrentState = true;
      return false;
    }
  });
  return readsCurrentState;
};

const isNodeControlledByStateInFrame = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  frame: EffectExecutionFrame,
  executionNode: EsTreeNode,
  stateDeclarator: EsTreeNode,
): boolean => {
  let child: EsTreeNode = executionNode;
  let cursor = child.parent;
  while (cursor && cursor !== frame.functionNode) {
    if (
      isNodeOfType(cursor, "IfStatement") &&
      (isAstDescendant(child, cursor.consequent as EsTreeNode) ||
        Boolean(cursor.alternate && isAstDescendant(child, cursor.alternate as EsTreeNode))) &&
      expressionReadsStateDeclarator(
        analysis,
        context,
        frame,
        cursor.test as EsTreeNode,
        stateDeclarator,
      )
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "ConditionalExpression") &&
      (isAstDescendant(child, cursor.consequent as EsTreeNode) ||
        isAstDescendant(child, cursor.alternate as EsTreeNode)) &&
      expressionReadsStateDeclarator(
        analysis,
        context,
        frame,
        cursor.test as EsTreeNode,
        stateDeclarator,
      )
    ) {
      return true;
    }
    if (
      isNodeOfType(cursor, "LogicalExpression") &&
      isAstDescendant(child, cursor.right as EsTreeNode) &&
      expressionReadsStateDeclarator(
        analysis,
        context,
        frame,
        cursor.left as EsTreeNode,
        stateDeclarator,
      )
    ) {
      return true;
    }
    if (isNodeOfType(cursor, "BlockStatement")) {
      const containingStatement = (cursor.body ?? []).find((statement) =>
        isAstDescendant(child, statement as EsTreeNode),
      ) as EsTreeNode | undefined;
      const containingStatementIndex = containingStatement
        ? (cursor.body ?? []).indexOf(containingStatement as never)
        : -1;
      for (let statementIndex = 0; statementIndex < containingStatementIndex; statementIndex += 1) {
        const precedingStatement = cursor.body?.[statementIndex] as EsTreeNode | undefined;
        if (
          precedingStatement &&
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitIfStatement(precedingStatement) &&
          expressionReadsStateDeclarator(
            analysis,
            context,
            frame,
            precedingStatement.test as EsTreeNode,
            stateDeclarator,
          )
        ) {
          return true;
        }
      }
    }
    child = cursor;
    cursor = cursor.parent;
  }
  return false;
};

const isWriteControlledByState = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  frameByFunctionNode: ReadonlyMap<EsTreeNode, EffectExecutionFrame>,
  frame: EffectExecutionFrame,
  callExpression: EsTreeNode,
  stateDeclarator: EsTreeNode,
): boolean => {
  if (functionalUpdaterReadsCurrentState(analysis, callExpression)) return true;
  let currentFrame: EffectExecutionFrame | undefined = frame;
  let executionNode = callExpression;
  const visitedFrames = new Set<EffectExecutionFrame>();
  while (currentFrame && !visitedFrames.has(currentFrame)) {
    visitedFrames.add(currentFrame);
    if (
      isNodeControlledByStateInFrame(
        analysis,
        context,
        currentFrame,
        executionNode,
        stateDeclarator,
      )
    ) {
      return true;
    }
    const invocation = currentFrame.invocation;
    if (!invocation) return false;
    const parentFunction = findEnclosingFunction(invocation);
    executionNode = invocation;
    currentFrame = parentFunction ? frameByFunctionNode.get(parentFunction) : undefined;
  }
  return false;
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
  context: RuleContext,
  effectNode: EsTreeNode,
  currentFilename?: string,
): ReadonlyArray<EffectStateWriteFact> => {
  const frames = collectBoundedEffectExecutionFrames(analysis, effectNode, currentFilename);
  if (frames.length === 0) return [];
  const frameByFunctionNode = new Map<EsTreeNode, EffectExecutionFrame>();
  for (const frame of frames) {
    if (!frameByFunctionNode.has(frame.functionNode)) {
      frameByFunctionNode.set(frame.functionNode, frame);
    }
  }
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
          currentFilename,
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
      const hasIndependentWriter = hasUserInputSetterWriter(
        analysis,
        context,
        setterReference,
        effectNode,
        true,
      );
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
        hasIndependentWriter,
        isDeferred: frame.isDeferred,
        isRenderKnownCopy,
        isSynchronousRenderValue:
          !frame.isDeferred &&
          !valueEvidence.hasUnknownSource &&
          !valueEvidence.hasDeferredIntroducedValue &&
          !valueEvidence.readsExternalValue,
        matchesStateInitializer: doesMatchStateInitializer,
        readsWrittenState: isWriteControlledByState(
          analysis,
          context,
          frameByFunctionNode,
          frame,
          callExpression,
          stateDeclarator,
        ),
        resetsSourceState: false,
        writtenIndexedMemberRootReference: isFunctionLike(writtenValue)
          ? getFunctionalUpdaterIndexedMemberRootReference(analysis, context, writtenValue, frame)
          : getWrittenIndexedMemberRootReference(analysis, writtenValue, frame),
        writesPropDerivedMemberValue: writesPropDerivedMemberValue(analysis, writtenValue, frame),
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
