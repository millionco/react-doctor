import type { Reference, Variable } from "eslint-scope";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { DOM_PROPERTY_TO_ALLOWED_TAGS } from "../../../constants/dom-property-tags.js";
import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { collectConstAliasSymbols } from "../../../utils/collect-const-alias-symbols.js";
import { collectEffectInvokedFunctions } from "../../../utils/collect-effect-invoked-functions.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenBrowserApiReceiver } from "../../../utils/is-proven-browser-api-receiver.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getCallExpr, getRef, getUpstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { resolveStateSetterReference } from "./effect/react.js";
import { hasDeferredOrExternalEffectWork } from "./has-deferred-or-external-effect-work.js";
import { isMediaElementRefReceiver } from "./is-media-element-ref-receiver.js";
import {
  isSetterWiredToJsxHandler,
  referencesIdentifierNamed,
} from "./is-controlled-prop-mirror.js";
import {
  resolveStateWriteSite,
  type EffectStateWriteSite,
} from "./collect-effect-state-write-facts.js";

const resourceLifecycleSetterReferencesByVariable = new WeakMap<Variable, readonly Reference[]>();

const RESOURCE_LIFECYCLE_EVENT_NAMES: ReadonlySet<string> = new Set([
  "onAbort",
  "onCanPlay",
  "onCanPlayThrough",
  "onEmptied",
  "onEncrypted",
  "onEnded",
  "onError",
  "onLoad",
  "onLoadedData",
  "onLoadedMetadata",
  "onLoadStart",
  "onProgress",
  "onStalled",
  "onSuspend",
  "onWaiting",
]);

const RESOURCE_IDENTITY_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "data",
  "href",
  "src",
  "srcSet",
]);

const RESOURCE_SYNC_METHOD_NAMES: ReadonlySet<string> = new Set(["load", "pause", "play"]);

const writesFailureLatch = (
  analysis: ProgramAnalysis,
  writtenValue: EsTreeNode | undefined,
  dependencyVariables: ReadonlySet<unknown>,
): boolean => {
  if (isNodeOfType(writtenValue, "Literal") && writtenValue.value === true) return true;
  if (!writtenValue) return false;
  if (isNodeOfType(writtenValue, "Identifier")) {
    const writtenReference = getRef(analysis, writtenValue);
    if (writtenReference?.resolved?.defs.some((definition) => definition.type === "Parameter")) {
      return true;
    }
  }
  let writesResourceIdentity = false;
  walkAst(writtenValue, (child) => {
    if (writesResourceIdentity) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    const reference = getRef(analysis, child);
    if (
      reference &&
      getUpstreamRefs(analysis, reference).some(
        (upstreamReference) =>
          upstreamReference.resolved && dependencyVariables.has(upstreamReference.resolved),
      )
    ) {
      writesResourceIdentity = true;
      return false;
    }
  });
  return writesResourceIdentity;
};

const isResourceLifecycleAttribute = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyVariables: ReadonlySet<unknown>,
  attribute: EsTreeNode,
): boolean => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  const attributeName = getJsxAttributeName(attribute.name);
  if (!attributeName || !RESOURCE_LIFECYCLE_EVENT_NAMES.has(attributeName)) return false;
  const openingElement = attribute.parent;
  if (
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isProvenIntrinsicJsxElement(openingElement, context.scopes)
  ) {
    return false;
  }
  const elementName = resolveJsxElementType(openingElement);
  if (!DOM_PROPERTY_TO_ALLOWED_TAGS.get(attributeName)?.has(elementName)) return false;

  let readsDependency = false;
  for (const siblingAttribute of openingElement.attributes ?? []) {
    if (siblingAttribute === attribute) continue;
    if (
      !isNodeOfType(siblingAttribute, "JSXAttribute") ||
      !RESOURCE_IDENTITY_ATTRIBUTE_NAMES.has(getJsxAttributeName(siblingAttribute.name) ?? "")
    ) {
      continue;
    }
    walkAst(siblingAttribute, (child): boolean | void => {
      if (readsDependency) return false;
      if (!isNodeOfType(child, "Identifier")) return;
      const reference = getRef(analysis, child);
      if (reference?.resolved && dependencyVariables.has(reference.resolved)) {
        readsDependency = true;
        return false;
      }
    });
    if (readsDependency) break;
  }
  return readsDependency;
};

const hasResourceIdentityElement = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyVariables: ReadonlySet<unknown>,
  componentFunction: EsTreeNode,
): boolean => {
  if (!isFunctionLike(componentFunction)) return false;
  let didFindResourceIdentity = false;
  walkAst(componentFunction.body, (child) => {
    if (didFindResourceIdentity) return false;
    if (!isNodeOfType(child, "JSXOpeningElement")) return;
    if (!isProvenIntrinsicJsxElement(child, context.scopes)) return;
    for (const attribute of child.attributes ?? []) {
      if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !RESOURCE_IDENTITY_ATTRIBUTE_NAMES.has(getJsxAttributeName(attribute.name) ?? "")
      ) {
        continue;
      }
      walkAst(attribute, (attributeChild) => {
        if (didFindResourceIdentity) return false;
        if (!isNodeOfType(attributeChild, "Identifier")) return;
        const reference = getRef(analysis, attributeChild);
        if (
          reference &&
          getUpstreamRefs(analysis, reference).some(
            (upstreamReference) =>
              upstreamReference.resolved && dependencyVariables.has(upstreamReference.resolved),
          )
        ) {
          didFindResourceIdentity = true;
          return false;
        }
      });
      if (didFindResourceIdentity) return false;
    }
  });
  return didFindResourceIdentity;
};

const isWrittenByResourceSyncEffect = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  write: EffectStateWriteSite,
  componentFunction: EsTreeNode,
  mediaReceiverCache?: WeakMap<SymbolDescriptor, boolean>,
): boolean => {
  let cursor: EsTreeNode | null | undefined = write.node;
  let effectCall: EsTreeNode | null = null;
  while (cursor && cursor !== componentFunction) {
    if (
      isFunctionLike(cursor) &&
      isNodeOfType(cursor.parent, "CallExpression") &&
      cursor.parent.arguments?.[0] === cursor &&
      isReactHookCall(cursor.parent, EFFECT_HOOK_NAMES, context.scopes)
    ) {
      effectCall = cursor.parent;
      break;
    }
    cursor = cursor.parent ?? null;
  }
  if (!effectCall || !isNodeOfType(effectCall, "CallExpression")) return false;
  if (hasDeferredOrExternalEffectWork(analysis, effectCall, context, write)) {
    return true;
  }
  const effectFunction = effectCall.arguments?.[0];
  if (!effectFunction || !isFunctionLike(effectFunction)) return false;
  const invokedFunctions = collectEffectInvokedFunctions(effectFunction, context.scopes);
  let didFindResourceSync = false;
  walkAst(effectFunction.body, (child) => {
    if (didFindResourceSync) return false;
    if (isFunctionLike(child) && !invokedFunctions.has(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    if (
      methodName &&
      RESOURCE_SYNC_METHOD_NAMES.has(methodName) &&
      (isProvenBrowserApiReceiver(callee.object, "dom-event-target", context.scopes) ||
        isMediaElementRefReceiver(callee.object, context.scopes, mediaReceiverCache))
    ) {
      didFindResourceSync = true;
      return false;
    }
  });
  return didFindResourceSync;
};

const isFunctionTransitivelyWiredToResourceHandler = (
  componentFunction: EsTreeNode,
  functionName: string,
  matchesAttribute: (attribute: EsTreeNode) => boolean,
): boolean => {
  if (!isFunctionLike(componentFunction)) return false;
  const pendingFunctionNames = [functionName];
  const visitedFunctionNames = new Set<string>();
  while (pendingFunctionNames.length > 0) {
    const pendingFunctionName = pendingFunctionNames.pop();
    if (!pendingFunctionName || visitedFunctionNames.has(pendingFunctionName)) continue;
    visitedFunctionNames.add(pendingFunctionName);
    if (isSetterWiredToJsxHandler(componentFunction, pendingFunctionName, matchesAttribute)) {
      return true;
    }
    walkAst(componentFunction.body, (child) => {
      if (!isFunctionLike(child)) return;
      const bindingIdentifier = getFunctionBindingIdentifier(child);
      if (
        isNodeOfType(bindingIdentifier, "Identifier") &&
        !visitedFunctionNames.has(bindingIdentifier.name) &&
        referencesIdentifierNamed(child.body, pendingFunctionName)
      ) {
        pendingFunctionNames.push(bindingIdentifier.name);
      }
    });
  }
  return false;
};

export const hasResourceLifecycleSetterWriter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterReference: Reference,
  effectNode: EsTreeNode,
  dependencyReferences: readonly Reference[],
  matchesStateInitializer: boolean,
  mediaReceiverCache?: WeakMap<SymbolDescriptor, boolean>,
  forwardedResetWrite?: EffectStateWriteSite,
): boolean => {
  const stateSetterReference = resolveStateSetterReference(analysis, setterReference);
  if (!stateSetterReference?.resolved) return false;
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction || !isFunctionLike(componentFunction)) return false;
  const dependencyVariables = new Set(
    dependencyReferences.flatMap((reference) =>
      getUpstreamRefs(analysis, reference).flatMap((upstreamReference) =>
        upstreamReference.resolved ? [upstreamReference.resolved] : [],
      ),
    ),
  );
  if (dependencyVariables.size === 0) return false;
  const resetCall = getCallExpr(setterReference);
  const directResetValue = isNodeOfType(resetCall, "CallExpression")
    ? (resetCall.arguments?.[0] as EsTreeNode | undefined)
    : undefined;
  const resetValue = forwardedResetWrite ? forwardedResetWrite.value : directResetValue;
  let isResourceKeyReconciliation = false;
  if (!matchesStateInitializer && resetValue && isFunctionLike(resetValue)) {
    const parameterNames = new Set(
      (resetValue.params ?? []).flatMap((parameter) =>
        isNodeOfType(parameter, "Identifier") ? [parameter.name] : [],
      ),
    );
    let readsPreviousValue = false;
    let readsDependency = false;
    let returnsNull = false;
    walkAst(resetValue.body, (child) => {
      if (isNodeOfType(child, "Literal") && child.value === null) returnsNull = true;
      if (!isNodeOfType(child, "Identifier")) return;
      if (parameterNames.has(child.name)) readsPreviousValue = true;
      const reference = getRef(analysis, child);
      if (
        reference &&
        getUpstreamRefs(analysis, reference).some(
          (upstreamReference) =>
            upstreamReference.resolved && dependencyVariables.has(upstreamReference.resolved),
        )
      ) {
        readsDependency = true;
      }
    });
    isResourceKeyReconciliation = readsPreviousValue && readsDependency && returnsNull;
  }
  if (!matchesStateInitializer && !isResourceKeyReconciliation) return false;
  const matchesAttribute = (attribute: EsTreeNode): boolean =>
    isResourceLifecycleAttribute(analysis, context, dependencyVariables, attribute);
  const hasMatchingResourceIdentity = hasResourceIdentityElement(
    analysis,
    context,
    dependencyVariables,
    componentFunction,
  );

  let setterReferences = resourceLifecycleSetterReferencesByVariable.get(
    stateSetterReference.resolved,
  );
  if (!setterReferences) {
    const setterSymbol = context.scopes.symbolFor(
      stateSetterReference.identifier as unknown as EsTreeNode,
    );
    setterReferences = setterSymbol
      ? collectConstAliasSymbols(setterSymbol, context.scopes).flatMap((symbol) => {
          if (symbol.references.some((reference) => reference.flag !== "read")) return [];
          return symbol.references.flatMap((reference) => {
            const setterRead = getRef(analysis, reference.identifier);
            return setterRead &&
              resolveStateSetterReference(analysis, setterRead)?.resolved ===
                stateSetterReference.resolved
              ? [setterRead]
              : [];
          });
        })
      : stateSetterReference.resolved.references;
    resourceLifecycleSetterReferencesByVariable.set(
      stateSetterReference.resolved,
      setterReferences,
    );
  }
  for (const reference of setterReferences) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    const referenceCall = getCallExpr(reference);
    const directCall = isNodeOfType(referenceCall, "CallExpression") ? referenceCall : null;
    const invocation = directCall ? null : findTransparentExpressionRoot(identifier).parent;
    const write = invocation ? resolveStateWriteSite(analysis, context, invocation) : null;
    if (
      (!directCall &&
        (!write ||
          resolveStateSetterReference(analysis, write.setterReference)?.resolved !==
            stateSetterReference.resolved)) ||
      !writesFailureLatch(
        analysis,
        directCall ? directCall.arguments[0] : write?.value,
        dependencyVariables,
      )
    )
      continue;
    let outermostFunctionBelowComponent: EsTreeNode | null = null;
    let cursor: EsTreeNode | null | undefined = identifier;
    while (cursor && cursor !== componentFunction) {
      if (isNodeOfType(cursor, "JSXAttribute") && matchesAttribute(cursor)) return true;
      if (isFunctionLike(cursor)) outermostFunctionBelowComponent = cursor;
      cursor = cursor.parent ?? null;
    }
    if (!outermostFunctionBelowComponent) continue;
    const bindingIdentifier = getFunctionBindingIdentifier(outermostFunctionBelowComponent);
    if (
      isNodeOfType(bindingIdentifier, "Identifier") &&
      (isSetterWiredToJsxHandler(
        componentFunction,
        stateSetterReference.identifier.name,
        matchesAttribute,
      ) ||
        isFunctionTransitivelyWiredToResourceHandler(
          componentFunction,
          bindingIdentifier.name,
          matchesAttribute,
        ))
    ) {
      return true;
    }
    if (hasMatchingResourceIdentity) {
      const writeSite =
        write ??
        (directCall
          ? { node: directCall, setter: directCall.callee, value: directCall.arguments[0] }
          : null);
      if (
        writeSite &&
        isWrittenByResourceSyncEffect(
          analysis,
          context,
          writeSite,
          componentFunction,
          mediaReceiverCache,
        )
      )
        return true;
    }
  }
  return false;
};
