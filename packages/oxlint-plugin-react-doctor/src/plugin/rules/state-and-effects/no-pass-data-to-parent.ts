import type { Reference } from "eslint-scope";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { isNamespacedApiCallee } from "../../utils/is-namespaced-api-call.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import {
  DATA_SINK_METHOD_NAMES,
  STRING_READ_METHOD_NAMES,
} from "../../constants/data-sink-method-names.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getDownstreamRefs,
  getRef,
  getUpstreamRefs,
  isSynchronous,
  resolveToFunction,
} from "./utils/effect/ast.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isConstant,
  isCustomHookParameter,
  isProp,
  isRefCall,
  isRefCurrent,
  isState,
  isWholePropsObjectReference,
} from "./utils/effect/react.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";
import { getParentCallbackPropNames } from "./utils/resolve-parent-callback-provenance.js";

// 1:1 port of upstream `src/rules/no-pass-data-to-parent.js`, narrowed to
// DIRECT parent-callback call sites. The verification run showed the
// eventual-call chain walk (`isPropCall`) misidentifying local utilities as
// parent callbacks: `setValue` destructured from `useForm(...)`, wrapper
// functions that mention a prop somewhere in their body, and useState
// setters seeded from a prop. The rule now requires the callee itself to
// resolve to a prop — or to a plain re-binding of one — before reporting.

// Local mirror of upstream's inline `isUseState`/`isUseRef` checks
// that work on the *identifier* of an upstream ref (not on a ref).
const isUseStateIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useState") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useState"
  ) {
    return true;
  }
  return false;
};

const isUseRefIdentifier = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (identifier.name === "useRef") return true;
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    isNodeOfType(parent.object, "Identifier") &&
    parent.object.name === "React" &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === "useRef"
  ) {
    return true;
  }
  return false;
};

// `fetchAllServiceMetrics(...)` / `loadMore()` / `dispatchAction(...)` props
// are commands ASKING the parent to do work, and `registerAccessors(...)` /
// `renderTile(ctx, ...)` props hand the parent an imperative API or draw
// into a context the child owns — none of them mirror data up (the redux
// `mapDispatchToProps` shape in particular is standard fetch-on-change
// dispatching; jaeger VirtualizedTraceView and freecut tiled-canvas were
// confirmed registration/draw false positives in the delta audit).
const COMMAND_PROP_NAME_PATTERN = /^(fetch|load|refetch|dispatch|register|render)([A-Z_]|$)/;

const SETTER_NAMED_PROP_PATTERN = /^set[A-Z]/;

const unwrapChainExpression = (node: EsTreeNode): EsTreeNode =>
  isNodeOfType(node, "ChainExpression") ? (node.expression as EsTreeNode) : node;

// Memoizing hooks that return the function they wrap: a binding like
// `const onToggle = useStableCallback((detail) => fireEvent(onChange, detail))`
// is a parent callback in a stable-identity coat, not a local utility.
const FUNCTION_WRAPPER_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useCallback",
  "useMemo",
  "useEvent",
  "useEventCallback",
  "useEffectEvent",
  "useMemoizedFn",
  "useStableCallback",
  "useCallbackRef",
]);

const getWrapperHookWrappedFunction = (
  initializer: EsTreeNode,
  resultSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  const transparentReactArgument = getTransparentReactCallbackWrapperArgument(
    initializer,
    resultSymbol,
    scopes,
  );
  if (transparentReactArgument) return transparentReactArgument;
  const callee = initializer.callee;
  const calleeName = isNodeOfType(callee, "Identifier")
    ? callee.name
    : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
      ? callee.property.name
      : null;
  if (!calleeName || !FUNCTION_WRAPPER_HOOK_NAMES.has(calleeName)) return null;
  const wrapped = initializer.arguments?.[0] as EsTreeNode | undefined;
  if (!wrapped) return null;
  if (calleeName === "useEffectEvent") return null;
  if (isFunctionLike(wrapped)) return wrapped;
  return null;
};

const HANDLER_NAMED_PROP_PATTERN = /^(on|handle)[A-Z]/;

// A wrapped body forwards to the parent only when it touches a
// handler-NAMED prop (`fire(onNavigationChange, detail)`) or invokes a prop
// outright. Merely READING data props (jaeger getAccessors builds an
// accessor object from props/refs) does not make the wrapper a parent
// callback.
const wrappedFunctionNotifiesParent = (
  analysis: ProgramAnalysis,
  wrappedFunction: EsTreeNode,
): boolean =>
  getDownstreamRefs(analysis, wrappedFunction).some((innerRef) => {
    if (!isProp(analysis, innerRef)) return false;
    const innerIdentifier = innerRef.identifier as unknown as EsTreeNode;
    if (
      isNodeOfType(innerIdentifier, "Identifier") &&
      HANDLER_NAMED_PROP_PATTERN.test(innerIdentifier.name)
    ) {
      return true;
    }
    const innerParent = (innerIdentifier as unknown as { parent?: EsTreeNode | null }).parent;
    return Boolean(
      innerParent &&
      isNodeOfType(innerParent, "CallExpression") &&
      innerParent.callee === (innerIdentifier as unknown as typeof innerParent.callee),
    );
  });

// A parent callback is the prop itself (`onChange(...)`), a plain
// re-binding of one (`const { onChange } = props`, `const cb =
// props.onChange`), or a SYNC function-wrapper-hook binding whose wrapped
// callback notifies a prop (`useStableCallback(() => fire(onChange, x))` —
// the cloudscape classic.tsx shape the delta audit flagged as lost recall).
// A binding produced by CALLING anything else (`const { setValue } =
// useForm({ defaultValues: props.initial })`) is a local utility, no
// matter how many props appear in the call.
const isDirectParentCallbackRef = (
  analysis: ProgramAnalysis,
  ref: Reference,
  scopes: ScopeAnalysis,
): boolean => {
  if (isProp(analysis, ref)) return true;
  if (hasMutableBindingWrite(ref)) {
    const bindingWrites =
      ref.resolved?.references.filter(
        (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
      ) ?? [];
    const writesOnlyParentCallbacks = bindingWrites.every((candidateReference) => {
      const candidateIdentifier = candidateReference.identifier as unknown as EsTreeNode;
      const assignment = candidateIdentifier.parent;
      if (
        !assignment ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        assignment.left !== (candidateIdentifier as unknown as typeof assignment.left)
      ) {
        return false;
      }
      const assignedReferences = getDownstreamRefs(analysis, assignment.right as EsTreeNode);
      return (
        assignedReferences.length > 0 &&
        assignedReferences.every((assignedReference) => isProp(analysis, assignedReference))
      );
    });
    if (!writesOnlyParentCallbacks) return false;
  }
  return Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const initializer = unwrapChainExpression(node.init as EsTreeNode);
      const resultSymbol = isNodeOfType(node.id, "Identifier")
        ? (scopes.symbolFor(node.id) ?? null)
        : null;
      const wrappedFunction = getWrapperHookWrappedFunction(initializer, resultSymbol, scopes);
      if (wrappedFunction) {
        if ((wrappedFunction as { async?: boolean }).async) return false;
        if (isFunctionLike(wrappedFunction)) {
          return wrappedFunctionNotifiesParent(analysis, wrappedFunction);
        }
        const directName = getParentCallbackPropName(analysis, wrappedFunction);
        const downstreamReferences = getDownstreamRefs(analysis, wrappedFunction);
        if (directName !== null) return true;
        return downstreamReferences.some(
          (wrappedReference) =>
            !hasMutableBindingWrite(wrappedReference) &&
            getUpstreamRefs(analysis, wrappedReference).some((upstreamReference) =>
              isProp(analysis, upstreamReference),
            ),
        );
      }
      if (
        !isNodeOfType(initializer, "Identifier") &&
        !isNodeOfType(initializer, "MemberExpression")
      ) {
        return false;
      }
      return getDownstreamRefs(analysis, initializer).some((initializerRef) =>
        getUpstreamRefs(analysis, initializerRef).some((upstreamRef) =>
          isProp(analysis, upstreamRef),
        ),
      );
    }),
  );
};

interface CallbackRefProvenance {
  callbackPropNames: ReadonlySet<string>;
}

interface RefBindingProvenance {
  refCall: EsTreeNodeOfType<"CallExpression">;
  variables: Set<NonNullable<Reference["resolved"]>>;
}

const getDeclarationKind = (declarator: EsTreeNode): string | null => {
  const declaration = declarator.parent;
  return declaration && isNodeOfType(declaration, "VariableDeclaration") ? declaration.kind : null;
};

const hasMutableBindingWrite = (reference: Reference): boolean =>
  Boolean(
    reference.resolved?.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    ),
  );

const getParentCallbackPropName = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  visitedVariables: Set<NonNullable<Reference["resolved"]>> = new Set(),
): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const callbackReference = getRef(analysis, unwrappedExpression);
    const callbackVariable = callbackReference?.resolved;
    if (!callbackReference || !callbackVariable || visitedVariables.has(callbackVariable)) {
      return null;
    }
    if (isProp(analysis, callbackReference)) {
      if (isWholePropsObjectReference(analysis, callbackReference)) return null;
      const parameterDefinition = callbackVariable.defs.find(
        (definition) => definition.type === "Parameter",
      );
      const bindingIdentifier = parameterDefinition?.name as unknown as EsTreeNode | undefined;
      return (
        (bindingIdentifier && getDestructuredBindingPropertyName(bindingIdentifier)) ??
        unwrappedExpression.name
      );
    }
    if (hasMutableBindingWrite(callbackReference)) return null;
    const definitions = callbackVariable.defs
      .map((definition) => definition.node as unknown as EsTreeNode)
      .filter((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
    if (definitions.length !== 1) return null;
    const declarator = definitions[0];
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      getDeclarationKind(declarator) !== "const" ||
      !declarator.init
    ) {
      return null;
    }
    visitedVariables.add(callbackVariable);
    if (isNodeOfType(declarator.id, "ObjectPattern")) {
      const bindingIdentifier = callbackVariable.defs[0]?.name as unknown as EsTreeNode | undefined;
      const propertyName = bindingIdentifier
        ? getDestructuredBindingPropertyName(bindingIdentifier)
        : null;
      const propsReference = getDownstreamRefs(analysis, declarator.init as EsTreeNode).find(
        (candidateReference) => isWholePropsObjectReference(analysis, candidateReference),
      );
      return propertyName && propsReference ? propertyName : null;
    }
    if (!isNodeOfType(declarator.id, "Identifier")) return null;
    return getParentCallbackPropName(analysis, declarator.init as EsTreeNode, visitedVariables);
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return null;
  const callbackName = getStaticMemberPropertyName(unwrappedExpression);
  if (!callbackName) return null;
  const receiver = stripParenExpression(unwrappedExpression.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const receiverReference = getRef(analysis, receiver);
  if (!receiverReference || !isWholePropsObjectReference(analysis, receiverReference)) return null;
  return callbackName;
};

const isNullishRefInitializer = (initializer: EsTreeNode | undefined): boolean => {
  if (!initializer) return true;
  const unwrappedInitializer = stripParenExpression(initializer);
  if (isNodeOfType(unwrappedInitializer, "Literal")) return unwrappedInitializer.value === null;
  if (!isNodeOfType(unwrappedInitializer, "Identifier")) return false;
  return unwrappedInitializer.name === "undefined";
};

const getDirectComponentBodyStatement = (
  node: EsTreeNode,
  componentBody: EsTreeNode,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node;
  while (current?.parent && current.parent !== componentBody) current = current.parent;
  return current?.parent === componentBody ? current : null;
};

const getVariableForDeclarator = (
  analysis: ProgramAnalysis,
  declarator: EsTreeNode,
): NonNullable<Reference["resolved"]> | null => {
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find((candidateVariable) =>
      candidateVariable.defs.some(
        (definition) => (definition.node as unknown as EsTreeNode) === declarator,
      ),
    );
    if (variable) return variable;
  }
  return null;
};

const getRefMember = (identifier: EsTreeNode): EsTreeNodeOfType<"MemberExpression"> | null => {
  const receiver = findTransparentExpressionRoot(identifier);
  const member = receiver.parent;
  if (
    !member ||
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== (receiver as unknown as typeof member.object)
  ) {
    return null;
  }
  return member;
};

const getRefMemberAssignment = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"AssignmentExpression"> | null => {
  const member = getRefMember(identifier);
  if (!member) return null;
  const memberRoot = findTransparentExpressionRoot(member);
  const assignment = memberRoot.parent;
  if (
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.left !== (memberRoot as unknown as typeof assignment.left)
  ) {
    return null;
  }
  return assignment;
};

const getRefAliasDeclarator = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  const initializer = findTransparentExpressionRoot(identifier);
  const declarator = initializer.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== (initializer as unknown as typeof declarator.init) ||
    !isNodeOfType(declarator.id, "Identifier") ||
    getDeclarationKind(declarator) !== "const"
  ) {
    return null;
  }
  return declarator;
};

const getRefBindingProvenance = (
  analysis: ProgramAnalysis,
  receiver: EsTreeNode,
  isReactUseRefCall: (node: EsTreeNode) => boolean,
): RefBindingProvenance | null => {
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const receiverReference = getRef(analysis, receiver);
  if (!receiverReference?.resolved || hasMutableBindingWrite(receiverReference)) return null;
  const variables = new Set<NonNullable<Reference["resolved"]>>();
  let currentVariable: NonNullable<Reference["resolved"]> | null = receiverReference.resolved;
  let refCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  while (currentVariable && !variables.has(currentVariable)) {
    variables.add(currentVariable);
    const definitions = currentVariable.defs
      .map((definition) => definition.node as unknown as EsTreeNode)
      .filter((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
    if (definitions.length !== 1) return null;
    const declarator = definitions[0];
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "Identifier") ||
      !declarator.init
    ) {
      return null;
    }
    if (
      isNodeOfType(declarator.init, "CallExpression") &&
      isReactUseRefCall(declarator.init as EsTreeNode)
    ) {
      refCall = declarator.init;
      break;
    }
    if (
      getDeclarationKind(declarator) !== "const" ||
      !isNodeOfType(stripParenExpression(declarator.init as EsTreeNode), "Identifier")
    ) {
      return null;
    }
    const upstreamReference = getRef(analysis, stripParenExpression(declarator.init as EsTreeNode));
    if (!upstreamReference?.resolved || hasMutableBindingWrite(upstreamReference)) return null;
    currentVariable = upstreamReference.resolved;
  }
  if (!refCall) return null;

  const pendingVariables = [...variables];
  while (pendingVariables.length > 0) {
    const variable = pendingVariables.pop();
    if (!variable) continue;
    for (const candidateReference of variable.references) {
      const aliasDeclarator = getRefAliasDeclarator(
        candidateReference.identifier as unknown as EsTreeNode,
      );
      if (!aliasDeclarator) continue;
      const aliasVariable = getVariableForDeclarator(analysis, aliasDeclarator);
      if (!aliasVariable || variables.has(aliasVariable)) continue;
      if (
        aliasVariable.references.some(
          (aliasReference) => aliasReference.isWrite() && !aliasReference.init,
        )
      ) {
        return null;
      }
      variables.add(aliasVariable);
      pendingVariables.push(aliasVariable);
    }
  }
  return { refCall, variables };
};

const getCallbackRefProvenance = (
  analysis: ProgramAnalysis,
  effectCall: EsTreeNode,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  isReactUseRefCall: (node: EsTreeNode) => boolean,
  isReactUseEffectCall: (node: EsTreeNode) => boolean,
): CallbackRefProvenance | null => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticMemberPropertyName(callee) !== "current"
  ) {
    return null;
  }
  const receiver = stripParenExpression(callee.object);
  const bindingProvenance = getRefBindingProvenance(analysis, receiver, isReactUseRefCall);
  if (!bindingProvenance) return null;
  const { refCall, variables } = bindingProvenance;

  const componentFunction = findEnclosingFunction(effectCall);
  if (
    !componentFunction ||
    !isFunctionLike(componentFunction) ||
    !isComponentFunction(componentFunction) ||
    !isNodeOfType(componentFunction.body, "BlockStatement")
  ) {
    return null;
  }
  const notificationEffectStatement = getDirectComponentBodyStatement(
    effectCall,
    componentFunction.body,
  );
  const notificationEffectRoot = findTransparentExpressionRoot(effectCall);
  if (
    !notificationEffectStatement ||
    !isNodeOfType(notificationEffectStatement, "ExpressionStatement") ||
    notificationEffectRoot.parent !== notificationEffectStatement ||
    !isReactUseEffectCall(effectCall)
  ) {
    return null;
  }

  const callbackPropNames = new Set<string>();
  const initializer = refCall.arguments?.[0] as EsTreeNode | undefined;
  const initializerCallbackName = initializer
    ? getParentCallbackPropName(analysis, initializer)
    : null;
  if (initializerCallbackName) {
    callbackPropNames.add(initializerCallbackName);
  } else if (!isNullishRefInitializer(initializer)) {
    return null;
  }

  for (const variable of variables) {
    for (const candidateReference of variable.references) {
      if (candidateReference.init) continue;
      if (candidateReference.isWrite()) return null;
      const identifier = candidateReference.identifier as unknown as EsTreeNode;
      if (getRefAliasDeclarator(identifier)) continue;
      const member = getRefMember(identifier);
      if (!member || getStaticMemberPropertyName(member) !== "current") return null;
      const memberRoot = findTransparentExpressionRoot(member);
      const memberParent = memberRoot.parent;
      if (
        memberParent &&
        (isNodeOfType(memberParent, "UpdateExpression") ||
          (isNodeOfType(memberParent, "UnaryExpression") && memberParent.operator === "delete"))
      ) {
        return null;
      }
      const assignment = getRefMemberAssignment(identifier);
      if (!assignment) continue;
      const assignmentRoot = findTransparentExpressionRoot(assignment);
      const assignmentStatement = assignmentRoot.parent;
      if (
        assignment.operator !== "=" ||
        !assignmentStatement ||
        !isNodeOfType(assignmentStatement, "ExpressionStatement")
      ) {
        return null;
      }
      const assignedCallbackName = getParentCallbackPropName(
        analysis,
        assignment.right as EsTreeNode,
      );
      if (!assignedCallbackName) return null;
      if (assignmentStatement.parent !== componentFunction.body) {
        if (!initializerCallbackName || assignedCallbackName !== initializerCallbackName) {
          return null;
        }
        const assignmentEffectBody = assignmentStatement.parent;
        if (!assignmentEffectBody || !isNodeOfType(assignmentEffectBody, "BlockStatement")) {
          return null;
        }
        const assignmentEffectFunction = assignmentEffectBody.parent;
        if (
          !assignmentEffectFunction ||
          !isFunctionLike(assignmentEffectFunction) ||
          assignmentEffectFunction.body !== assignmentEffectBody
        ) {
          return null;
        }
        const assignmentEffectFunctionRoot =
          findTransparentExpressionRoot(assignmentEffectFunction);
        const assignmentEffectCall = assignmentEffectFunctionRoot.parent;
        if (
          !assignmentEffectCall ||
          !isNodeOfType(assignmentEffectCall, "CallExpression") ||
          !isReactUseEffectCall(assignmentEffectCall) ||
          getEffectFn(analysis, assignmentEffectCall) !== assignmentEffectFunction
        ) {
          return null;
        }
        const assignmentEffectStatement = getDirectComponentBodyStatement(
          assignmentEffectCall,
          componentFunction.body,
        );
        if (
          !assignmentEffectStatement ||
          !isNodeOfType(assignmentEffectStatement, "ExpressionStatement") ||
          assignmentEffectCall.parent !== assignmentEffectStatement ||
          assignmentEffectStatement.range[0] >= notificationEffectStatement.range[0]
        ) {
          return null;
        }
      }
      callbackPropNames.add(assignedCallbackName);
    }
  }

  return callbackPropNames.size > 0 ? { callbackPropNames } : null;
};

const isParentPropsContextMerge = (analysis: ProgramAnalysis, expression: EsTreeNode): boolean => {
  let currentExpression = stripParenExpression(expression);
  const visitedVariables = new Set<NonNullable<Reference["resolved"]>>();
  while (isNodeOfType(currentExpression, "Identifier")) {
    const currentReference = getRef(analysis, currentExpression);
    const currentVariable = currentReference?.resolved;
    if (
      !currentReference ||
      !currentVariable ||
      visitedVariables.has(currentVariable) ||
      hasMutableBindingWrite(currentReference)
    ) {
      return false;
    }
    visitedVariables.add(currentVariable);
    const definitions = currentVariable.defs.filter((definition) =>
      isNodeOfType(definition.node as unknown as EsTreeNode, "VariableDeclarator"),
    );
    if (definitions.length !== 1) return false;
    const declarator = definitions[0]?.node as unknown as EsTreeNode | undefined;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      getDeclarationKind(declarator) !== "const" ||
      !declarator.init
    ) {
      return false;
    }
    currentExpression = stripParenExpression(declarator.init as EsTreeNode);
  }
  if (!isNodeOfType(currentExpression, "ObjectExpression")) return false;
  const [contextSpread, propsSpread] = currentExpression.properties ?? [];
  if (
    currentExpression.properties?.length !== 2 ||
    !contextSpread ||
    !propsSpread ||
    !isNodeOfType(contextSpread, "SpreadElement") ||
    !isNodeOfType(propsSpread, "SpreadElement")
  ) {
    return false;
  }
  const propsExpression = stripParenExpression(propsSpread.argument as EsTreeNode);
  if (!isNodeOfType(propsExpression, "Identifier")) return false;
  const propsReference = getRef(analysis, propsExpression);
  if (
    !propsReference?.resolved ||
    !isWholePropsObjectReference(analysis, propsReference) ||
    hasMutableBindingWrite(propsReference) ||
    propsReference.resolved.references.some(
      (candidateReference) => candidateReference !== propsReference,
    )
  ) {
    return false;
  }
  const contextExpression = stripParenExpression(contextSpread.argument as EsTreeNode);
  if (!isNodeOfType(contextExpression, "Identifier")) return false;
  const contextReference = getRef(analysis, contextExpression);
  if (
    !contextReference?.resolved ||
    hasMutableBindingWrite(contextReference) ||
    contextReference.resolved.references.some(
      (candidateReference) => !candidateReference.init && candidateReference !== contextReference,
    )
  ) {
    return false;
  }
  const contextInitializer = contextReference.resolved?.defs
    .map((definition) => definition.node as unknown as EsTreeNode)
    .find((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
  if (
    !contextInitializer ||
    !isNodeOfType(contextInitializer, "VariableDeclarator") ||
    getDeclarationKind(contextInitializer) !== "const" ||
    !contextInitializer.init ||
    !isNodeOfType(contextInitializer.init, "CallExpression")
  ) {
    return false;
  }
  const contextHook = stripParenExpression(contextInitializer.init.callee as EsTreeNode);
  if (!isNodeOfType(contextHook, "Identifier") || !/^use[A-Z].*Context$/.test(contextHook.name)) {
    return false;
  }
  const contextHookReference = getRef(analysis, contextHook);
  return Boolean(
    contextHookReference?.resolved?.defs.some((definition) => definition.type === "ImportBinding"),
  );
};

const getImmutableParentCallbackPropName = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
): string | null => {
  let currentExpression = stripParenExpression(expression);
  const visitedVariables = new Set<NonNullable<Reference["resolved"]>>();
  while (isNodeOfType(currentExpression, "Identifier")) {
    const currentReference = getRef(analysis, currentExpression);
    const currentVariable = currentReference?.resolved;
    if (
      !currentReference ||
      !currentVariable ||
      visitedVariables.has(currentVariable) ||
      hasMutableBindingWrite(currentReference)
    ) {
      return null;
    }
    visitedVariables.add(currentVariable);
    const definition = currentVariable.defs.length === 1 ? currentVariable.defs[0] : null;
    const bindingIdentifier = definition?.name as unknown as EsTreeNode | undefined;
    if (bindingIdentifier && isNodeOfType(bindingIdentifier.parent, "AssignmentPattern")) {
      return null;
    }
    const definitionNode = definition?.node as unknown as EsTreeNode | undefined;
    if (!definitionNode || !isNodeOfType(definitionNode, "VariableDeclarator")) {
      return getParentCallbackPropName(analysis, currentExpression);
    }
    if (getDeclarationKind(definitionNode) !== "const" || !definitionNode.init) return null;
    if (isNodeOfType(definitionNode.id, "ObjectPattern")) {
      return (
        getParentCallbackPropName(analysis, currentExpression) ??
        (isParentPropsContextMerge(analysis, definitionNode.init as EsTreeNode)
          ? getDestructuredBindingPropertyName(bindingIdentifier ?? currentExpression)
          : null)
      );
    }
    if (!isNodeOfType(definitionNode.id, "Identifier")) return null;
    currentExpression = stripParenExpression(definitionNode.init as EsTreeNode);
    if (
      !isNodeOfType(currentExpression, "Identifier") &&
      !isNodeOfType(currentExpression, "MemberExpression")
    ) {
      return null;
    }
  }
  return null;
};

const objectExpressionPreservesCallbackProperty = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  propertyName: string,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (!isNodeOfType(unwrappedExpression, "ObjectExpression")) return false;
  let callbackSourceName: string | null = null;
  for (const property of unwrappedExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) return false;
    const candidatePropertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
    });
    if (candidatePropertyName === null) return false;
    if (candidatePropertyName !== propertyName) continue;
    if (callbackSourceName || property.kind !== "init") return false;
    if (!isNodeOfType(stripParenExpression(property.value as EsTreeNode), "Identifier")) {
      return false;
    }
    callbackSourceName = getImmutableParentCallbackPropName(analysis, property.value as EsTreeNode);
    if (!callbackSourceName) return false;
  }
  return callbackSourceName === propertyName;
};

const refCurrentObjectPreservesCallbackProperty = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  propertyName: string,
  isReactUseRefCall: (node: EsTreeNode) => boolean,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "MemberExpression") ||
    getStaticMemberPropertyName(unwrappedExpression) !== "current"
  ) {
    return false;
  }
  const bindingProvenance = getRefBindingProvenance(
    analysis,
    stripParenExpression(unwrappedExpression.object),
    isReactUseRefCall,
  );
  if (!bindingProvenance) return false;
  const initializer = bindingProvenance.refCall.arguments?.[0] as EsTreeNode | undefined;
  if (
    !initializer ||
    !objectExpressionPreservesCallbackProperty(analysis, initializer, propertyName)
  ) {
    return false;
  }
  for (const variable of bindingProvenance.variables) {
    for (const candidateReference of variable.references) {
      if (candidateReference.init) continue;
      const identifier = candidateReference.identifier as unknown as EsTreeNode;
      if (getRefAliasDeclarator(identifier)) continue;
      const currentMember = getRefMember(identifier);
      if (!currentMember || getStaticMemberPropertyName(currentMember) !== "current") return false;
      const currentAssignment = getRefMemberAssignment(identifier);
      if (currentAssignment) {
        if (
          currentAssignment.operator !== "=" ||
          !objectExpressionPreservesCallbackProperty(
            analysis,
            currentAssignment.right as EsTreeNode,
            propertyName,
          )
        ) {
          return false;
        }
        continue;
      }
      const currentRoot = findTransparentExpressionRoot(currentMember);
      const currentParent = currentRoot.parent;
      if (
        currentParent &&
        isNodeOfType(currentParent, "VariableDeclarator") &&
        currentParent.init === (currentRoot as unknown as typeof currentParent.init) &&
        isNodeOfType(currentParent.id, "ObjectPattern")
      ) {
        continue;
      }
      if (
        currentParent &&
        isNodeOfType(currentParent, "MemberExpression") &&
        currentParent.object === (currentRoot as unknown as typeof currentParent.object) &&
        getStaticMemberPropertyName(currentParent) === propertyName
      ) {
        const propertyRoot = findTransparentExpressionRoot(currentParent);
        const propertyParent = propertyRoot.parent;
        if (!propertyParent || !isNodeOfType(propertyParent, "VariableDeclarator")) {
          return false;
        }
        continue;
      }
      return false;
    }
  }
  return true;
};

const getCommandCallbackPropName = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  isReactUseRefCall: (node: EsTreeNode) => boolean,
): string | null => {
  const directCallbackName = getImmutableParentCallbackPropName(analysis, expression);
  if (directCallbackName && COMMAND_PROP_NAME_PATTERN.test(directCallbackName)) {
    return directCallbackName;
  }
  let currentExpression = stripParenExpression(expression);
  const visitedVariables = new Set<NonNullable<Reference["resolved"]>>();
  while (isNodeOfType(currentExpression, "Identifier")) {
    const callbackReference = getRef(analysis, currentExpression);
    const callbackVariable = callbackReference?.resolved;
    if (
      !callbackReference ||
      !callbackVariable ||
      visitedVariables.has(callbackVariable) ||
      hasMutableBindingWrite(callbackReference)
    ) {
      return null;
    }
    visitedVariables.add(callbackVariable);
    const definition = callbackVariable.defs.length === 1 ? callbackVariable.defs[0] : null;
    const declarator = definition?.node as unknown as EsTreeNode | undefined;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      getDeclarationKind(declarator) !== "const" ||
      !declarator.init
    ) {
      return null;
    }
    const bindingIdentifier = definition?.name as unknown as EsTreeNode | undefined;
    if (bindingIdentifier && isNodeOfType(bindingIdentifier.parent, "AssignmentPattern")) {
      return null;
    }
    if (isNodeOfType(declarator.id, "ObjectPattern")) {
      const propertyName = bindingIdentifier
        ? getDestructuredBindingPropertyName(bindingIdentifier)
        : null;
      if (!propertyName || !COMMAND_PROP_NAME_PATTERN.test(propertyName)) return null;
      return refCurrentObjectPreservesCallbackProperty(
        analysis,
        declarator.init as EsTreeNode,
        propertyName,
        isReactUseRefCall,
      )
        ? propertyName
        : null;
    }
    if (!isNodeOfType(declarator.id, "Identifier")) return null;
    currentExpression = stripParenExpression(declarator.init as EsTreeNode);
  }
  if (!isNodeOfType(currentExpression, "MemberExpression")) return null;
  const propertyName = getStaticMemberPropertyName(currentExpression);
  if (!propertyName || !COMMAND_PROP_NAME_PATTERN.test(propertyName)) return null;
  return refCurrentObjectPreservesCallbackProperty(
    analysis,
    currentExpression.object as EsTreeNode,
    propertyName,
    isReactUseRefCall,
  )
    ? propertyName
    : null;
};

// The wrapper hides the data hand-off inside the wrapped body
// (`fireNonCancelableEvent(onNavigationChange, { open: isOpen })`), so the
// direct call's arguments alone can be all-literal; scan the call-chain
// arguments the way the pre-narrowing rule did.
const isWrapperHookCallbackRef = (
  analysis: ProgramAnalysis,
  ref: Reference,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const resultSymbol = isNodeOfType(node.id, "Identifier")
        ? (scopes.symbolFor(node.id) ?? null)
        : null;
      return (
        getWrapperHookWrappedFunction(
          unwrapChainExpression(node.init as EsTreeNode),
          resultSymbol,
          scopes,
        ) !== null
      );
    }),
  );

// `onZoomHandlersReady({ handleZoomIn, handleZoomOut })` — an object whose
// every property is a function hands the parent an imperative API bag
// (a useImperativeHandle equivalent), not data mirrored up (freecut
// timeline-content, confirmed in the delta audit).
const isHandlerBagArgument = (analysis: ProgramAnalysis, argument: EsTreeNode): boolean => {
  if (!isNodeOfType(argument, "ObjectExpression")) return false;
  const properties = argument.properties ?? [];
  if (properties.length === 0) return false;
  return properties.every((property) => {
    if (!isNodeOfType(property, "Property")) return false;
    const value = property.value as EsTreeNode;
    if (isFunctionLike(value)) return true;
    if (isNodeOfType(value, "Identifier")) {
      const valueRef = getRef(analysis, value);
      return Boolean(valueRef && resolveToFunction(valueRef));
    }
    return false;
  });
};

// A functional updater handed to a setter-named prop (`setConfig((prev) =>
// ({ ...prev, secret: generate() }))`) is a payload PRODUCER, not a callback
// registered for later — its body must be scanned for child-generated data
// (bulwarkmail SecurityStep, a delta-audit recall regression). The updater's
// own parameters carry the parent's existing value back in, so they are not
// data the child produced.
const getFunctionalUpdaterDataRefs = (
  analysis: ProgramAnalysis,
  updater: EsTreeNode,
): Reference[] =>
  getDownstreamRefs(analysis, updater).filter(
    (updaterRef) =>
      !updaterRef.resolved?.defs.some(
        (def) => def.type === "Parameter" && (def.node as unknown) === (updater as unknown),
      ),
  );

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

const EXTERNAL_SUBSCRIPTION_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useIntersectionObserver",
  "useMatchMedia",
  "useMediaJobProgress",
  "useMediaQuery",
  "useMediaQueryState",
  "useResizeObserver",
  "useVisibility",
  "useWindowSize",
]);

const isCallbackPropReference = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  if (!isProp(analysis, ref)) return false;
  const identifier = ref.identifier as unknown as EsTreeNode;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  if (!isWholePropsObjectReference(analysis, ref)) {
    return HANDLER_NAMED_PROP_PATTERN.test(identifier.name);
  }
  const member = identifier.parent;
  if (
    !member ||
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== (identifier as unknown as typeof member.object)
  ) {
    return false;
  }
  const propertyName = getStaticMemberPropertyName(member);
  return Boolean(propertyName && HANDLER_NAMED_PROP_PATTERN.test(propertyName));
};

// A value produced by a custom hook that is itself WIRED TO the component's
// props (`useMarqueeSelection({ containerRef, onSelectionChange, ... })`)
// is hook-owned interaction state the component merely bridges up — the
// parent already participates through the callbacks it passed down, so the
// effect is the only bridge left (freecut TimelineMarqueeLayer, delta
// audit). A bare hook call (`useSomeAPI()`) stays data: the parent could
// call the hook itself.
const isParentWiredHookResultRef = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const init = unwrapChainExpression(node.init as EsTreeNode);
      if (!isNodeOfType(init, "CallExpression")) return false;
      const callee = init.callee;
      if (!isNodeOfType(callee, "Identifier") || !HOOK_NAME_PATTERN.test(callee.name)) {
        return false;
      }
      return (init.arguments ?? []).some((hookArgument) =>
        getDownstreamRefs(analysis, hookArgument as EsTreeNode).some((downstreamRef) =>
          isCallbackPropReference(analysis, downstreamRef),
        ),
      );
    }),
  );

const isParentWiredHookResultArgument = (
  analysis: ProgramAnalysis,
  argument: EsTreeNode,
): boolean => {
  if (!isNodeOfType(argument, "Identifier")) return false;
  const argumentRef = getRef(analysis, argument);
  if (!argumentRef) return false;
  return isParentWiredHookResultRef(analysis, argumentRef);
};

// The upstream chase through a derived local (`const effectiveFilename =
// hasStaticFallback ? fallbackFilename : filename`) bottoms out at the hook
// CALLEE identifier itself (`useMediaJobProgress`), which must not read as
// component-produced data when the hook is wired to props.
const isParentWiredHookCalleeRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  const identifier = ref.identifier as unknown as EsTreeNode;
  if (!isNodeOfType(identifier, "Identifier") || !HOOK_NAME_PATTERN.test(identifier.name)) {
    return false;
  }
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (
    !parent ||
    !isNodeOfType(parent, "CallExpression") ||
    parent.callee !== (identifier as unknown as typeof parent.callee)
  ) {
    return false;
  }
  return (parent.arguments ?? []).some((hookArgument) =>
    getDownstreamRefs(analysis, hookArgument as EsTreeNode).some((downstreamRef) =>
      isCallbackPropReference(analysis, downstreamRef),
    ),
  );
};

const getLocalHookExternalStateProof = (
  analysis: ProgramAnalysis,
  ref: Reference,
): boolean | null => {
  let hookFunction = resolveToFunction(ref);
  if (!hookFunction) {
    for (const definition of ref.resolved?.defs ?? []) {
      const definitionNode = definition.node as unknown as EsTreeNode;
      if (!isNodeOfType(definitionNode, "VariableDeclarator") || !definitionNode.init) continue;
      const initializer = stripParenExpression(definitionNode.init as EsTreeNode);
      if (!isNodeOfType(initializer, "CallExpression")) continue;
      const callee = stripParenExpression(initializer.callee as EsTreeNode);
      if (!isNodeOfType(callee, "Identifier")) continue;
      const calleeReference = getRef(analysis, callee);
      if (!calleeReference) continue;
      hookFunction = resolveToFunction(calleeReference);
      if (hookFunction) break;
    }
  }
  if (!hookFunction) return null;
  const returnedReferences = collectFunctionReturnStatements(hookFunction).flatMap(
    (returnStatement) =>
      returnStatement.argument
        ? getDownstreamRefs(analysis, returnStatement.argument as EsTreeNode)
        : [],
  );
  if (returnedReferences.length === 0) return null;
  return returnedReferences.every(
    (returnedReference) =>
      isState(analysis, returnedReference) && isExternallyDrivenState(analysis, returnedReference),
  );
};

const isExternalSubscriptionHookRef = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  const identifier = ref.identifier as unknown as EsTreeNode;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const localHookProof = getLocalHookExternalStateProof(analysis, ref);
  if (localHookProof !== null) return localHookProof;
  if (EXTERNAL_SUBSCRIPTION_HOOK_NAMES.has(identifier.name) && isCalleePosition(identifier)) {
    return true;
  }
  return Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return false;
      const initializer = stripParenExpression(node.init as EsTreeNode);
      if (!isNodeOfType(initializer, "CallExpression")) return false;
      const callee = stripParenExpression(initializer.callee as EsTreeNode);
      return (
        isNodeOfType(callee, "Identifier") && EXTERNAL_SUBSCRIPTION_HOOK_NAMES.has(callee.name)
      );
    }),
  );
};

const isImportBindingRef = (ref: Reference): boolean =>
  Boolean(ref.resolved?.defs.some((def) => def.type === "ImportBinding"));

const isCalleePosition = (identifier: EsTreeNode): boolean => {
  const parent = (identifier as unknown as { parent?: EsTreeNode | null }).parent;
  return Boolean(
    parent &&
    (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
    parent.callee === (identifier as unknown as typeof parent.callee),
  );
};

export const noPassDataToParent = defineRule({
  id: "no-pass-data-to-parent",
  title: "Data passed to parent via effect",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Fetch the data in the parent and pass it down as a prop (or return it from the hook), instead of handing it back up through a prop callback in a useEffect. See https://react.dev/learn/you-might-not-need-an-effect#passing-data-to-the-parent",
  create: (context: RuleContext) => {
    const isReactUseRefCall = (node: EsTreeNode): boolean =>
      isReactHookCall(node, "useRef", context.scopes);
    const isReactUseEffectCall = (node: EsTreeNode): boolean =>
      isReactHookCall(node, "useEffect", context.scopes);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactUseEffectCall(node)) return;
        const analysis = getProgramAnalysis(node);
        if (!analysis) return;
        if (hasCleanup(analysis, node)) return;
        const effectFnRefs = getEffectFnRefs(analysis, node);
        if (!effectFnRefs) return;
        const effectFn = getEffectFn(analysis, node);
        if (!effectFn) return;

        for (const ref of effectFnRefs) {
          const callExpr = getCallExpr(ref);
          if (!callExpr || !isNodeOfType(callExpr, "CallExpression")) continue;
          const callbackRefProvenance = getCallbackRefProvenance(
            analysis,
            node,
            callExpr,
            isReactUseRefCall,
            isReactUseEffectCall,
          );
          if (!isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn)) continue;

          const calleeNode = unwrapChainExpression(callExpr.callee as EsTreeNode);
          const identifier = ref.identifier as unknown as EsTreeNode;
          const resolvedCallbackPropNames =
            isNodeOfType(calleeNode, "MemberExpression") &&
            getStaticMemberPropertyName(calleeNode) === "current"
              ? null
              : getParentCallbackPropNames({
                  analysis,
                  expression: calleeNode,
                  scopes: context.scopes,
                });
          const callbackPropNames =
            callbackRefProvenance?.callbackPropNames ?? resolvedCallbackPropNames;
          if (isRefCall(analysis, ref) && !callbackPropNames) continue;

          if (callbackPropNames) {
            if (
              [...callbackPropNames].some((callbackPropName) =>
                COMMAND_PROP_NAME_PATTERN.test(callbackPropName),
              )
            ) {
              continue;
            }
          } else if (calleeNode === identifier) {
            // Bare form: `onChange(data)` — callee must BE a prop (or a
            // plain alias of one), not a local function that eventually
            // mentions a prop.
            const callbackPropName = getCommandCallbackPropName(
              analysis,
              identifier,
              isReactUseRefCall,
            );
            if (callbackPropName && COMMAND_PROP_NAME_PATTERN.test(callbackPropName)) {
              continue;
            }
            if (!isDirectParentCallbackRef(analysis, ref, context.scopes)) continue;
            if (
              isNodeOfType(identifier, "Identifier") &&
              COMMAND_PROP_NAME_PATTERN.test(identifier.name)
            ) {
              continue;
            }
          } else if (
            isNodeOfType(calleeNode, "MemberExpression") &&
            stripParenExpression(calleeNode.object) === identifier
          ) {
            // Member form: `props.onLoaded(data)` — only the whole props
            // object of a COMPONENT qualifies. A positional custom-hook
            // parameter (`cy.batch(...)`) is an external instance.
            if (!isWholePropsObjectReference(analysis, ref)) continue;
            if (isCustomHookParameter(ref)) continue;
          } else {
            continue;
          }

          // Skip well-known prototype/observer/promise methods —
          // `props.items.forEach(fn)`, `props.store.subscribe(fn)`,
          // `props.fetcher.then(fn)` are NOT "passing data to a parent
          // via a callback", they're iteration / subscription /
          // chaining patterns that happen to receive a callback. The
          // rule's intent is `props.onDataLoaded(data)` style hand-back,
          // which never uses these method names.
          const methodName = getCallMethodName(calleeNode);
          // ...except when a string-read name is called directly ON the
          // props object: `props.search(results)` is a parent callback
          // that happens to be named like `String.prototype.search`.
          const isPropCallbackNamedLikeStringRead = Boolean(
            methodName &&
            STRING_READ_METHOD_NAMES.has(methodName) &&
            isNodeOfType(calleeNode, "MemberExpression") &&
            stripParenExpression(calleeNode.object) === (ref.identifier as unknown as EsTreeNode) &&
            isWholePropsObjectReference(analysis, ref),
          );
          if (
            methodName &&
            DATA_SINK_METHOD_NAMES.has(methodName) &&
            !isPropCallbackNamedLikeStringRead &&
            !callbackPropNames
          ) {
            continue;
          }
          if (methodName && COMMAND_PROP_NAME_PATTERN.test(methodName)) continue;
          // `editor.commands.setSelection(...)`, `props.store.dispatch(...)`,
          // `props.queryClient.invalidate(...)` etc. — calling a method
          // on a namespaced API object, not handing data back to a parent.
          if (!callbackPropNames && isNamespacedApiCallee(calleeNode)) continue;

          const isSetterNamedCallee = callbackPropNames
            ? [...callbackPropNames].every((callbackPropName) =>
                SETTER_NAMED_PROP_PATTERN.test(callbackPropName),
              )
            : Boolean(
                (isNodeOfType(identifier, "Identifier") ? identifier.name : methodName) &&
                SETTER_NAMED_PROP_PATTERN.test(
                  (isNodeOfType(identifier, "Identifier") ? identifier.name : methodName) ?? "",
                ),
              );
          const isLeafRef = (argRef: Reference): boolean =>
            getUpstreamRefs(analysis, argRef).length === 1;
          const argsUpstreamRefs = (callExpr.arguments ?? [])
            .flatMap((argument) => {
              // A function-valued argument is a callback handed up for
              // REGISTRATION — the parent calls the child later, so data
              // flows down, not up. The exception is a functional updater
              // handed to a setter-named callee: its body produces the
              // payload, so it is scanned (minus its own parameters).
              if (isFunctionLike(argument as EsTreeNode)) {
                if (!isSetterNamedCallee) return [];
                return getFunctionalUpdaterDataRefs(analysis, argument as EsTreeNode);
              }
              if (isHandlerBagArgument(analysis, argument as EsTreeNode)) return [];
              if (isParentWiredHookResultArgument(analysis, argument as EsTreeNode)) return [];
              if (isNodeOfType(argument, "Identifier")) {
                const argumentRef = getRef(analysis, argument as EsTreeNode);
                if (argumentRef && resolveToFunction(argumentRef)) return [];
              }
              return getDownstreamRefs(analysis, argument as EsTreeNode);
            })
            .flatMap((argumentRef) =>
              isExternallyDrivenState(analysis, argumentRef) ||
              isExternalSubscriptionHookRef(analysis, argumentRef)
                ? []
                : getUpstreamRefs(analysis, argumentRef),
            )
            .filter(isLeafRef);
          // A wrapper-hook callee hides the hand-off in its wrapped body, so
          // its data refs live on the eventual call chain, not the direct
          // call's arguments.
          if (
            calleeNode === identifier &&
            isWrapperHookCallbackRef(analysis, ref, context.scopes)
          ) {
            argsUpstreamRefs.push(...getArgsUpstreamRefs(analysis, ref).filter(isLeafRef));
          }

          const isSomeArgsData = argsUpstreamRefs.some((argRef) => {
            if (isUseStateIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
            if (isExternalSubscriptionHookRef(analysis, argRef)) return false;
            if (isProp(analysis, argRef)) return false;
            if (isUseRefIdentifier(argRef.identifier as unknown as EsTreeNode)) return false;
            if (isRefCurrent(argRef)) return false;
            if (isConstant(argRef)) return false;
            // A leaf sourced from a parent-wired hook stays hook-owned even
            // when it reaches the callback through a derived local
            // (`const effectiveFilename = hasStaticFallback ? fallbackFilename
            // : filename` — PortOS MediaJobThumb, docs-validation round 2).
            if (isParentWiredHookResultRef(analysis, argRef)) return false;
            if (isParentWiredHookCalleeRef(analysis, argRef)) return false;
            // Only real function BINDINGS are registration callbacks; a
            // parameter reference resolves to null (its binding holds data,
            // not a callable), so a forwarded data parameter is not mistaken
            // for one (cloudscape custom-forms, a delta-audit recall
            // regression).
            if (resolveToFunction(argRef)) return false;
            // An imported binding in argument (not callee) position is
            // static module config (`subscribe(EVENT_NAME, handler)`),
            // not component-derived data.
            const argIdentifier = argRef.identifier as unknown as EsTreeNode;
            if (isImportBindingRef(argRef) && !isCalleePosition(argIdentifier)) return false;
            // `props.onReset(undefined)` is an imperative clear, not data
            // lifted to a parent. `undefined` is a global identifier with no
            // resolved def, so `isConstant` (which only inspects an init
            // expression) misses it — recognize it explicitly.
            if (isNodeOfType(argIdentifier, "Identifier") && argIdentifier.name === "undefined") {
              return false;
            }
            return true;
          });
          if (!isSomeArgsData) continue;

          context.report({
            node: callExpr,
            message:
              "Handing data back to a parent from a useEffect costs your users an extra render.",
          });
        }
      },
    };
  },
});
