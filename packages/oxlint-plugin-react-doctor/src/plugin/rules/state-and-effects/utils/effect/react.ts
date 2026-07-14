import type { Reference } from "eslint-scope";
import type { ScopeAnalysis } from "../../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../../utils/get-static-property-name.js";
import { getRootIdentifier } from "../../../../utils/get-root-identifier.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../../../utils/has-symbol-write-before.js";
import { isAstNode } from "../../../../utils/is-ast-node.js";
import { isFunctionLike } from "../../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../../utils/is-node-of-type.js";
import { resolveFirstArgumentBinding } from "../../../../utils/resolve-first-argument-binding.js";
import {
  TRANSPARENT_EXPRESSION_WRAPPER_TYPES,
  stripParenExpression,
} from "../../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../../utils/walk-ast.js";
import {
  getDownstreamRefs,
  getRef,
  getUpstreamRefs,
  hasParameterDefinition,
  isEventualCallTo,
  isSynchronous,
  resolvesToAsyncFunction,
  resolveToFunction,
} from "./ast.js";
import { FIRST_ARGUMENT_INDEX, SECOND_ARGUMENT_INDEX } from "./constants.js";
import { getAstChildKeys } from "./get-ast-child-keys.js";
import { getScopeForNode, type ProgramAnalysis } from "./get-program-analysis.js";
import { isProvenNativeReadMethod } from "./is-proven-native-read-method.js";

// 1:1 port of upstream `src/util/react.js` from
// `eslint-plugin-react-you-might-not-need-an-effect`. See `./ast.ts`
// for the matching analyzer-side port.

const KNOWN_PURE_HOC_NAMES = new Set(["memo", "forwardRef"]);

const startsWithUppercase = (name: string | undefined): boolean =>
  Boolean(name && name.length > 0 && name[0] >= "A" && name[0] <= "Z");

const isReactFunctionalComponent = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "FunctionDeclaration")) {
    return Boolean(node.id && startsWithUppercase(node.id.name));
  }
  if (isNodeOfType(node, "VariableDeclarator")) {
    if (!isNodeOfType(node.id, "Identifier")) return false;
    if (!startsWithUppercase(node.id.name)) return false;
    const init = node.init;
    if (!init) return false;
    return isNodeOfType(init, "ArrowFunctionExpression") || isNodeOfType(init, "CallExpression");
  }
  return false;
};

const isReactFunctionalHOC = (
  analysis: ProgramAnalysis,
  node: EsTreeNode | null | undefined,
): boolean => {
  if (!isReactFunctionalComponent(node)) return false;
  if (!isNodeOfType(node, "VariableDeclarator")) return false;
  const init = node.init;
  if (!init) return false;

  // inline: `const MyComponent = withRouter(() => ...)`
  const isWrappedInline = (): boolean => {
    if (!isNodeOfType(init, "CallExpression")) return false;
    if (!isNodeOfType(init.callee, "Identifier")) return false;
    if (KNOWN_PURE_HOC_NAMES.has(init.callee.name)) return false;
    const firstArg = init.arguments?.[0];
    if (!firstArg) return false;
    return (
      isNodeOfType(firstArg, "ArrowFunctionExpression") ||
      isNodeOfType(firstArg, "FunctionExpression")
    );
  };

  // separately: `export default withRouter(MyComponent);` and
  // `const Wrapped = inject('x')(observer(MyComponent))`.
  // We find the Variable for `MyComponent` directly through the
  // scope manager (instead of relying on `getRef(node.id)` resolving
  // the LHS init reference, which depends on scope-analyzer
  // particulars) and inspect each of its references.
  const isWrappedSeparately = (): boolean => {
    if (!isNodeOfType(node.id, "Identifier")) return false;
    const bindingName = node.id.name;
    const containingScope = getScopeForNode(node as unknown as EsTreeNode, analysis);
    if (!containingScope) return false;
    const variable = containingScope.variables.find((v) => v.name === bindingName);
    if (!variable) return false;
    for (const reference of variable.references) {
      const parent = (reference.identifier as unknown as { parent?: EsTreeNode | null }).parent;
      if (!parent || !isNodeOfType(parent, "CallExpression")) continue;
      const args = parent.arguments ?? [];
      const refId = reference.identifier as unknown as (typeof args)[number];
      if (!args.includes(refId)) continue;
      const callee = parent.callee;
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "CallExpression") && isNodeOfType(callee.callee, "Identifier")
          ? callee.callee.name
          : null;
      if (calleeName != null && !KNOWN_PURE_HOC_NAMES.has(calleeName)) {
        return true;
      }
    }
    return false;
  };

  return isWrappedInline() || isWrappedSeparately();
};

export const isCustomHook = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "FunctionDeclaration")) {
    const name = node.id?.name;
    if (!name) return false;
    return name.startsWith("use") && name.length > 3 && name[3] >= "A" && name[3] <= "Z";
  }
  if (isNodeOfType(node, "VariableDeclarator")) {
    if (!isNodeOfType(node.id, "Identifier")) return false;
    const name = node.id.name;
    const init = node.init;
    if (!init) return false;
    if (
      !isNodeOfType(init, "ArrowFunctionExpression") &&
      !isNodeOfType(init, "FunctionExpression")
    ) {
      return false;
    }
    return name.startsWith("use") && name.length > 3 && name[3] >= "A" && name[3] <= "Z";
  }
  return false;
};

// A bare (non-destructured) parameter of a CUSTOM HOOK is a positional
// argument (`useRunLayout(cy)`), not a component's props object —
// method calls on it (`cy.batch(...)`) drive an external instance.
export const isCustomHookParameter = (ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      if (def.type !== "Parameter") return false;
      const functionNode = def.node as unknown as EsTreeNode;
      if (isCustomHook(functionNode)) return true;
      const parent = (functionNode as unknown as { parent?: EsTreeNode | null }).parent;
      return Boolean(parent && isCustomHook(parent));
    }),
  );

const isReactNamedImportReference = (ref: Reference | null, importedName: string): boolean =>
  Boolean(
    ref?.resolved?.defs.some((def) => {
      if (def.type !== "ImportBinding") return false;
      const declarationNode = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(declarationNode, "ImportSpecifier")) return false;
      const imported = declarationNode.imported as EsTreeNode;
      if (!isNodeOfType(imported, "Identifier")) return false;
      if (imported.name !== importedName) return false;
      const importDeclaration = declarationNode.parent;
      return Boolean(
        importDeclaration &&
        isNodeOfType(importDeclaration, "ImportDeclaration") &&
        isNodeOfType(importDeclaration.source as EsTreeNode, "Literal") &&
        importDeclaration.source.value === "react",
      );
    }),
  );

const isReactNamespaceImportReference = (ref: Reference | null): boolean =>
  Boolean(
    ref?.resolved?.defs.some((def) => {
      if (def.type !== "ImportBinding") return false;
      const declarationNode = def.node as unknown as EsTreeNode;
      if (
        !isNodeOfType(declarationNode, "ImportNamespaceSpecifier") &&
        !isNodeOfType(declarationNode, "ImportDefaultSpecifier")
      ) {
        return false;
      }
      const importDeclaration = declarationNode.parent;
      return Boolean(
        importDeclaration &&
        isNodeOfType(importDeclaration, "ImportDeclaration") &&
        isNodeOfType(importDeclaration.source as EsTreeNode, "Literal") &&
        importDeclaration.source.value === "react",
      );
    }),
  );

export const isGenuineReactHookDeclarator = (
  analysis: ProgramAnalysis,
  declarator: EsTreeNode,
  hookName: string,
): boolean => {
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.init, "CallExpression")
  ) {
    return false;
  }
  const callee = stripParenExpression(declarator.init.callee);
  if (isNodeOfType(callee, "Identifier")) {
    const reference = getRef(analysis, callee);
    if (!reference?.resolved) return callee.name === hookName;
    return isReactNamedImportReference(reference, hookName);
  }
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.object, "Identifier") ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== hookName
  ) {
    return false;
  }
  const namespaceReference = getRef(analysis, callee.object);
  if (!namespaceReference?.resolved) return callee.object.name === "React";
  return isReactNamespaceImportReference(namespaceReference);
};

const isHookCallee = (
  analysis: ProgramAnalysis,
  node: EsTreeNode | null | undefined,
  hookName: string,
): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Identifier")) {
    if (node.name === hookName) return true;
    if (isReactNamedImportReference(getRef(analysis, node), hookName)) return true;
    const parent = (node as unknown as { parent?: EsTreeNode | null }).parent;
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      isNodeOfType(parent.object, "Identifier") &&
      parent.object.name === "React" &&
      isNodeOfType(parent.property, "Identifier") &&
      parent.property.name === hookName
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    const receiver = stripParenExpression(node.object);
    return (
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "React" &&
      isNodeOfType(node.property, "Identifier") &&
      node.property.name === hookName
    );
  }
  return false;
};

export const isUseEffect = (node: EsTreeNode | null | undefined): boolean => {
  if (!node || !isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier") && callee.name === "useEffect") return true;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "React" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "useEffect"
  );
};

export const getEffectFn = (analysis: ProgramAnalysis, node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const fn = node.arguments?.[0];
  if (!fn) return null;
  if (isNodeOfType(fn, "ArrowFunctionExpression") || isNodeOfType(fn, "FunctionExpression")) {
    return fn as EsTreeNode;
  }
  if (isNodeOfType(fn, "Identifier")) {
    const ref = getRef(analysis, fn);
    return ref ? resolveToFunction(ref) : null;
  }
  return null;
};

export const getEffectFnRefs = (
  analysis: ProgramAnalysis,
  node: EsTreeNode,
): Reference[] | null => {
  const fn = getEffectFn(analysis, node);
  if (!fn) return null;
  return getDownstreamRefs(analysis, fn);
};

export const getEffectDepsRefs = (
  analysis: ProgramAnalysis,
  node: EsTreeNode,
): Reference[] | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const deps = node.arguments?.[1];
  if (!deps || !isNodeOfType(deps, "ArrayExpression")) return null;
  return getDownstreamRefs(analysis, deps as EsTreeNode);
};

export const isState = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      if (!isNodeOfType(node.init, "CallExpression")) return false;
      if (!isHookCallee(analysis, node.init.callee as EsTreeNode, "useState")) return false;
      if (!isNodeOfType(node.id, "ArrayPattern")) return false;
      const elements = node.id.elements ?? [];
      if (elements.length !== 1 && elements.length !== 2) return false;
      const first = elements[0];
      return Boolean(
        first && isNodeOfType(first, "Identifier") && first.name === ref.identifier.name,
      );
    }),
  );

export const isStateSetter = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      if (!isNodeOfType(node.init, "CallExpression")) return false;
      if (!isHookCallee(analysis, node.init.callee as EsTreeNode, "useState")) return false;
      if (!isNodeOfType(node.id, "ArrayPattern")) return false;
      const elements = node.id.elements ?? [];
      if (elements.length !== 2) return false;
      const second = elements[1];
      return Boolean(
        second && isNodeOfType(second, "Identifier") && second.name === ref.identifier.name,
      );
    }),
  );

export const isProp = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      if (def.type !== "Parameter") return false;
      const defNode = def.node as unknown as EsTreeNode;
      let declaringNode: EsTreeNode | null | undefined = defNode;
      if (
        isNodeOfType(defNode, "ArrowFunctionExpression") ||
        isNodeOfType(defNode, "FunctionExpression")
      ) {
        let parent = (defNode as unknown as { parent?: EsTreeNode | null }).parent;
        // `memo(forwardRef((props, ref) => ...))` nests pure HOC calls, so
        // ascend through every CallExpression wrapper to the declarator.
        while (parent && isNodeOfType(parent, "CallExpression")) {
          parent = (parent as unknown as { parent?: EsTreeNode | null }).parent;
        }
        declaringNode = parent;
      }
      if (!declaringNode) return false;
      return (
        (isReactFunctionalComponent(declaringNode) &&
          !isReactFunctionalHOC(analysis, declaringNode)) ||
        isCustomHook(declaringNode)
      );
    }),
  );

const isWholePropsParameterBinding = (bindingNode: EsTreeNode): boolean => {
  if (isFunctionLike(bindingNode.parent)) return true;
  let declaringFunction: EsTreeNode | null | undefined = bindingNode.parent;
  while (declaringFunction && !isFunctionLike(declaringFunction)) {
    declaringFunction = declaringFunction.parent;
  }
  return Boolean(
    declaringFunction && resolveFirstArgumentBinding(declaringFunction.params?.[0]) === bindingNode,
  );
};

// True when the reference binds the WHOLE props object (`(props) =>`)
// rather than a destructured prop value (`({ text }) =>`). Calling a
// method directly on the props object (`props.search(results)`) calls
// a parent-supplied callback prop, even when the method name collides
// with a string-prototype read — whereas `text.startsWith(x)` reads
// from a prop value.
export const isWholePropsObjectReference = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  isProp(analysis, ref) &&
  Boolean(
    ref.resolved?.defs.some((def) => {
      if (def.type !== "Parameter") return false;
      return isWholePropsParameterBinding(def.name as unknown as EsTreeNode);
    }),
  );

const isIdentifierOrMemberExpression = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Identifier") || isNodeOfType(node, "MemberExpression");

const isPropAlias = (analysis: ProgramAnalysis, ref: Reference): boolean => {
  if (isProp(analysis, ref)) return true;
  return Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      const initializer = node.init as EsTreeNode | null;
      if (!initializer) return false;
      if (!isNodeOfType(node.id, "ObjectPattern") && !isIdentifierOrMemberExpression(initializer)) {
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

export const isConstant = (ref: Reference): boolean =>
  Boolean(
    (ref.resolved?.defs ?? []).some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      const init = node.init;
      if (!init) return false;
      return (
        isNodeOfType(init, "Literal") ||
        isNodeOfType(init, "TemplateLiteral") ||
        isNodeOfType(init, "ArrayExpression") ||
        isNodeOfType(init, "ObjectExpression")
      );
    }),
  );

const isRef = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  Boolean(
    ref.resolved?.defs.some((def) => {
      const node = def.node as unknown as EsTreeNode;
      if (!isNodeOfType(node, "VariableDeclarator")) return false;
      if (!isNodeOfType(node.init, "CallExpression")) return false;
      return isHookCallee(analysis, node.init.callee as EsTreeNode, "useRef");
    }),
  );

export const isRefCurrent = (ref: Reference): boolean => {
  const parent = (ref.identifier as unknown as { parent?: EsTreeNode | null }).parent;
  if (!parent || !isNodeOfType(parent, "MemberExpression")) return false;
  if (!isNodeOfType(parent.property, "Identifier")) return false;
  return parent.property.name === "current";
};

export const isStateSetterCall = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  isEventualCallTo(analysis, ref, (innerRef) => isStateSetter(analysis, innerRef));

// The shared "is this a synchronous, hoistable state-setter call worth
// reporting" filter for the mount-effect rules. A direct `setState()` at
// a synchronous call site qualifies; a setter reached only indirectly
// through an `async` intermediate function does not (it isn't hoistable
// to a `useState` initializer).
export const isSyncStateSetterCall = (
  analysis: ProgramAnalysis,
  ref: Reference,
  effectFn: EsTreeNode,
): boolean =>
  isStateSetterCall(analysis, ref) &&
  isSynchronous(ref.identifier as unknown as EsTreeNode, effectFn) &&
  !resolvesToAsyncFunction(ref);

export const isPropCall = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  isEventualCallTo(analysis, ref, (innerRef) => isPropAlias(analysis, innerRef));

const HANDLER_NAMED_METHOD_PATTERN = /^(on|handle)[A-Z]/;
const SYNCHRONOUS_CALLBACK_ARGUMENT_INDEX_BY_METHOD: ReadonlyMap<string, number> = new Map([
  ["every", FIRST_ARGUMENT_INDEX],
  ["filter", FIRST_ARGUMENT_INDEX],
  ["find", FIRST_ARGUMENT_INDEX],
  ["findIndex", FIRST_ARGUMENT_INDEX],
  ["findLast", FIRST_ARGUMENT_INDEX],
  ["findLastIndex", FIRST_ARGUMENT_INDEX],
  ["flatMap", FIRST_ARGUMENT_INDEX],
  ["forEach", FIRST_ARGUMENT_INDEX],
  ["map", FIRST_ARGUMENT_INDEX],
  ["reduce", FIRST_ARGUMENT_INDEX],
  ["reduceRight", FIRST_ARGUMENT_INDEX],
  ["replace", SECOND_ARGUMENT_INDEX],
  ["replaceAll", SECOND_ARGUMENT_INDEX],
  ["some", FIRST_ARGUMENT_INDEX],
]);

interface PropCallbackInvocationOptions {
  nativeMethodScopes?: ScopeAnalysis;
}

const addSimpleBindingNames = (pattern: EsTreeNode, names: Set<string>): boolean => {
  if (isNodeOfType(pattern, "Identifier")) {
    if (names.has(pattern.name)) return false;
    names.add(pattern.name);
    return true;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return addSimpleBindingNames(pattern.left, names);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return addSimpleBindingNames(pattern.argument, names);
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    let didAddName = false;
    for (const property of pattern.properties) {
      const binding = isNodeOfType(property, "Property") ? property.value : property;
      didAddName = addSimpleBindingNames(binding, names) || didAddName;
    }
    return didAddName;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    let didAddName = false;
    for (const element of pattern.elements) {
      if (element) didAddName = addSimpleBindingNames(element, names) || didAddName;
    }
    return didAddName;
  }
  return false;
};

const getSimpleParameterNames = (callback: EsTreeNode): Set<string> => {
  if (!isFunctionLike(callback)) return new Set();
  const names = new Set<string>();
  for (const parameter of callback.params ?? []) {
    addSimpleBindingNames(parameter, names);
  }
  return names;
};

const inlineCallbackInvokesParameter = (callback: EsTreeNode): boolean => {
  const parameterNames = getSimpleParameterNames(callback);
  if (parameterNames.size === 0 || !isFunctionLike(callback)) return false;
  let didAddAlias = true;
  while (didAddAlias) {
    didAddAlias = false;
    walkAst(callback.body, (candidate) => {
      if (candidate !== callback.body && isFunctionLike(candidate)) return false;
      if (
        isNodeOfType(candidate, "AssignmentExpression") &&
        candidate.operator === "=" &&
        isNodeOfType(candidate.left, "Identifier")
      ) {
        const assignedValueRoot = getRootIdentifier(candidate.right);
        if (
          isNodeOfType(assignedValueRoot, "Identifier") &&
          parameterNames.has(assignedValueRoot.name) &&
          !parameterNames.has(candidate.left.name)
        ) {
          parameterNames.add(candidate.left.name);
          didAddAlias = true;
        }
        return;
      }
      if (!isNodeOfType(candidate, "VariableDeclarator") || !candidate.init) return;
      const initializerRoot = getRootIdentifier(candidate.init);
      if (
        !isNodeOfType(initializerRoot, "Identifier") ||
        !parameterNames.has(initializerRoot.name)
      ) {
        return;
      }
      if (addSimpleBindingNames(candidate.id, parameterNames)) {
        didAddAlias = true;
      }
    });
  }
  let didInvokeParameter = false;
  walkAst(callback.body, (candidate) => {
    if (didInvokeParameter) return false;
    if (candidate !== callback.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (isNodeOfType(callee, "Identifier") && parameterNames.has(callee.name)) {
      didInvokeParameter = true;
      return false;
    }
    if (isNodeOfType(callee, "MemberExpression")) {
      const receiverRoot = getRootIdentifier(callee.object);
      if (receiverRoot && parameterNames.has(receiverRoot.name)) {
        didInvokeParameter = true;
        return false;
      }
    }
  });
  return didInvokeParameter;
};

const callbackInvokesPropCallback = (analysis: ProgramAnalysis, callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  let didInvokePropCallback = false;
  walkAst(callback.body, (candidate) => {
    if (didInvokePropCallback) return false;
    if (candidate !== callback.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (
      getDownstreamRefs(analysis, callee).some((reference) =>
        isPropCallbackInvocationRef(analysis, reference),
      )
    ) {
      didInvokePropCallback = true;
      return false;
    }
  });
  return didInvokePropCallback;
};

const isNativeMethodSuppressionSafe = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNode,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = scopes.symbolFor(receiver);
  if (
    !receiverSymbol ||
    hasSymbolWriteBefore(receiverSymbol, callExpression, scopes) ||
    hasPossibleStaticPropertyWriteBefore(receiver, methodName, callExpression, scopes)
  ) {
    return false;
  }
  let callResult: EsTreeNode = callExpression;
  let callResultConsumer = callResult.parent;
  while (
    callResultConsumer &&
    ((TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(callResultConsumer.type) &&
      "expression" in callResultConsumer &&
      callResultConsumer.expression === callResult) ||
      (isNodeOfType(callResultConsumer, "MemberExpression") &&
        callResultConsumer.object === callResult))
  ) {
    callResult = callResultConsumer;
    callResultConsumer = callResult.parent;
  }
  if (
    isNodeOfType(callResultConsumer, "CallExpression") &&
    callResultConsumer.callee === callResult
  ) {
    return false;
  }
  const callbackArgumentIndex = SYNCHRONOUS_CALLBACK_ARGUMENT_INDEX_BY_METHOD.get(methodName);
  if (callbackArgumentIndex === undefined) return true;
  const callbackArgument = callExpression.arguments?.[callbackArgumentIndex];
  if (!callbackArgument) return true;
  const callbackValue = stripParenExpression(callbackArgument);
  if (isFunctionLike(callbackValue)) {
    return (
      !inlineCallbackInvokesParameter(callbackValue) &&
      !callbackInvokesPropCallback(analysis, callbackValue)
    );
  }
  if (!isNodeOfType(callbackValue, "Identifier")) return false;
  const callbackRef = getRef(analysis, callbackValue);
  if (!callbackRef || isPropAlias(analysis, callbackRef)) return false;
  const callbackFunction = resolveToFunction(callbackRef);
  return Boolean(
    callbackFunction &&
    isFunctionLike(callbackFunction) &&
    !inlineCallbackInvokesParameter(callbackFunction) &&
    !callbackInvokesPropCallback(analysis, callbackFunction),
  );
};

// A prop reference invoked AS a callback: `onEnd(x)`, an alias call, or a
// method called on a whole (non-destructured) parameter object
// (`props.onSave(x)`, `colorModel.equal(x)`). A data method on a destructured
// prop value (`hrefs.find(...)`) READS the prop — it never calls back to the
// parent, so eventual-call chains through it must not count as parent pushes.
// A handler-bag prop is the exception: `handlers.handleUpdateProgress(x)` /
// `callbacks.onProgress(x)` invoke a parent-supplied callback grouped under
// an object prop, so `on[A-Z]` / `handle[A-Z]` method names stay callbacks
// (internxt FileVideoViewer, caught by the 0.7.1→sweep delta audit).
export const isPropCallbackInvocationRef = (
  analysis: ProgramAnalysis,
  ref: Reference,
  options: PropCallbackInvocationOptions = {},
): boolean => {
  if (!isPropAlias(analysis, ref)) return false;
  const identifier = ref.identifier as unknown as EsTreeNode;
  let effectiveNode = identifier;
  let parent = (effectiveNode as unknown as { parent?: EsTreeNode | null }).parent;
  while (
    parent &&
    TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
    "expression" in parent &&
    parent.expression === effectiveNode
  ) {
    effectiveNode = parent;
    parent = (effectiveNode as unknown as { parent?: EsTreeNode | null }).parent;
  }
  if (!parent) return false;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === effectiveNode) return true;
  if (isNodeOfType(parent, "MemberExpression") && parent.object === effectiveNode) {
    const memberParent = (parent as unknown as { parent?: EsTreeNode | null }).parent;
    if (isNodeOfType(memberParent, "CallExpression") && memberParent.callee === parent) {
      const propertyName = getStaticPropertyName(parent);
      if (propertyName && HANDLER_NAMED_METHOD_PATTERN.test(propertyName)) {
        return true;
      }
      if (
        options.nativeMethodScopes &&
        isCustomHookParameter(ref) &&
        propertyName &&
        isProvenNativeReadMethod(ref, propertyName) &&
        isNativeMethodSuppressionSafe(
          analysis,
          memberParent,
          propertyName,
          options.nativeMethodScopes,
        )
      ) {
        return false;
      }
      return isWholePropsObjectReference(analysis, ref);
    }
  }
  return false;
};

export const isRefCall = (analysis: ProgramAnalysis, ref: Reference): boolean =>
  isEventualCallTo(
    analysis,
    ref,
    (innerRef) => isRefCurrent(innerRef) || isRef(analysis, innerRef),
  );

export const getUseStateDecl = (analysis: ProgramAnalysis, ref: Reference): EsTreeNode | null => {
  const useStateRef = getUpstreamRefs(analysis, ref).find((upRef) =>
    isHookCallee(analysis, upRef.identifier as unknown as EsTreeNode, "useState"),
  );
  let node: EsTreeNode | null | undefined = useStateRef?.identifier as unknown as EsTreeNode;
  while (node && !isNodeOfType(node, "VariableDeclarator")) {
    node = (node as unknown as { parent?: EsTreeNode | null }).parent;
  }
  return node ?? null;
};

const isCleanupReturnArgument = (analysis: ProgramAnalysis, node: EsTreeNode): boolean => {
  if (isFunctionLike(node)) return true;
  if (isNodeOfType(node, "MemberExpression")) return true;
  if (isNodeOfType(node, "Identifier")) {
    const ref = getRef(analysis, node);
    if (ref && (hasParameterDefinition(ref) || resolveToFunction(ref))) return true;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isCleanupReturnArgument(analysis, node.consequent as EsTreeNode) ||
      isCleanupReturnArgument(analysis, node.alternate as EsTreeNode)
    );
  }
  return false;
};

const hasCleanupReturn = (
  analysis: ProgramAnalysis,
  node: EsTreeNode,
  visited: WeakSet<object> = new WeakSet(),
): boolean => {
  if (visited.has(node)) return false;
  visited.add(node);
  if (isNodeOfType(node, "ReturnStatement") && node.argument != null) {
    return isCleanupReturnArgument(analysis, node.argument as EsTreeNode);
  }
  if (!isNodeOfType(node, "BlockStatement") && isFunctionLike(node)) return false;
  const record = node as unknown as Record<string, unknown>;
  const childKeys = getAstChildKeys(node);
  for (let keyIndex = 0; keyIndex < childKeys.length; keyIndex += 1) {
    const value = record[childKeys[keyIndex]];
    if (Array.isArray(value)) {
      for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
        const item = value[itemIndex];
        if (isAstNode(item) && hasCleanupReturn(analysis, item, visited)) return true;
      }
    } else if (isAstNode(value) && hasCleanupReturn(analysis, value, visited)) {
      return true;
    }
  }
  return false;
};

export const hasCleanup = (analysis: ProgramAnalysis, node: EsTreeNode): boolean => {
  const fn = getEffectFn(analysis, node);
  if (!isFunctionLike(fn)) return false;
  // A concise arrow body IS the returned value:
  // `useEffect(() => subscribe(cb), deps)` returns the disposer.
  if (!isNodeOfType(fn.body, "BlockStatement")) {
    return isCleanupReturnArgument(analysis, fn.body as EsTreeNode);
  }
  return hasCleanupReturn(analysis, fn.body as EsTreeNode);
};

export const findContainingNode = (
  analysis: ProgramAnalysis,
  node: EsTreeNode | null | undefined,
): EsTreeNode | null => {
  if (!node) return null;
  if (
    isReactFunctionalComponent(node) ||
    isReactFunctionalHOC(analysis, node) ||
    isCustomHook(node)
  ) {
    return node;
  }
  const parent = (node as unknown as { parent?: EsTreeNode | null }).parent;
  return findContainingNode(analysis, parent);
};
