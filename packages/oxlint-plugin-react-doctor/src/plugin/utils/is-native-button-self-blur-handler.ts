import {
  NATIVE_SELF_BLUR_ARGUMENT_COUNT,
  NATIVE_SELF_BLUR_REFUSED_ATTRIBUTE_NAMES,
  NATIVE_SELF_BLUR_REFUSED_MEMBER_NAMES,
  NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES,
  NATIVE_SELF_BLUR_REFUSED_RUNTIME_NAMES,
  NATIVE_SELF_BLUR_SINGLE_PARAMETER_COUNT,
  NATIVE_SELF_BLUR_REFUSED_RUNTIME_TYPESCRIPT_NODES,
  NATIVE_SELF_BLUR_TIMER_NAMES,
} from "./constants.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFiniteStaticStringValues } from "./get-finite-static-string-values.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isErasedTypeScriptNamespace } from "./is-erased-typescript-namespace.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const stableProviderByScopes = new WeakMap<ScopeAnalysis, boolean>();

const hasStableNativeBlurProvider = (context: RuleContext): boolean => {
  const { scopes } = context;
  const cached = stableProviderByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let isStable = !hasReactDefaultProviderMutation("createElement", scopes);
  walkAst(scopes.rootScope.node, (node) => {
    if (!isStable) return false;
    if (
      NATIVE_SELF_BLUR_REFUSED_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      (isNodeOfType(node, "TSModuleDeclaration") && !isErasedTypeScriptNamespace(node))
    ) {
      isStable = false;
      return false;
    }
    if (isNodeOfType(node, "TSImportEqualsDeclaration")) {
      if (
        node.importKind !== "type" &&
        (!isNodeOfType(node.moduleReference, "TSExternalModuleReference") ||
          NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES.has(
            getStaticStringExpression(node.moduleReference.expression) ?? "",
          ))
      ) {
        isStable = false;
      }
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportExpression")) {
      isStable = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (
        node.importKind !== "type" &&
        NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES.has(String(node.source.value))
      ) {
        isStable = false;
      }
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (
        node.name === "require" &&
        (scopes.referenceFor(node) !== null || symbol?.bindingIdentifier === node)
      ) {
        const loader = findTransparentExpressionRoot(node);
        const call = loader.parent;
        if (
          !scopes.isGlobalReference(node) ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== loader ||
          call.optional
        ) {
          isStable = false;
        }
      }
      if (
        NATIVE_SELF_BLUR_TIMER_NAMES.has(node.name) &&
        (scopes.referenceFor(node) !== null || symbol?.bindingIdentifier === node)
      ) {
        const timer = findTransparentExpressionRoot(node);
        const call = timer.parent;
        const callback =
          isNodeOfType(call, "CallExpression") && call.arguments[0]
            ? stripParenExpression(call.arguments[0])
            : null;
        if (
          !scopes.isGlobalReference(node) ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== timer ||
          call.optional ||
          (!isNodeOfType(callback, "ArrowFunctionExpression") &&
            !isNodeOfType(callback, "FunctionExpression"))
        ) {
          isStable = false;
        }
      }
      if (
        NATIVE_SELF_BLUR_REFUSED_RUNTIME_NAMES.has(node.name) &&
        (scopes.referenceFor(node) !== null || symbol?.bindingIdentifier === node)
      ) {
        isStable = false;
      }
      return;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (
        isNodeOfType(callee, "Identifier") &&
        scopes.isGlobalReference(callee) &&
        callee.name === "require" &&
        [...getFiniteStaticStringValues(node.arguments[0], context)].some((source) =>
          NATIVE_SELF_BLUR_REFUSED_MODULE_SOURCES.has(source),
        )
      ) {
        isStable = false;
      }
      return;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, scopes);
      if (
        propertyName === null ||
        NATIVE_SELF_BLUR_REFUSED_MEMBER_NAMES.has(propertyName) ||
        (isNodeOfType(node, "MemberExpression") &&
          (propertyName === "blur" ||
            propertyName === "createElement" ||
            propertyName === "jsx" ||
            propertyName === "jsxs" ||
            propertyName === "jsxDEV") &&
          isMemberMutationTarget(node))
      ) {
        isStable = false;
      }
    }
  });
  stableProviderByScopes.set(scopes, isStable);
  return isStable;
};

export const isNativeButtonSelfBlurHandler = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  handlerAttribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(openingElement.name, "JSXIdentifier") ||
    openingElement.name.name !== "button"
  ) {
    return false;
  }
  const attributeNames = new Set<string>();
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const attributeName = getJsxAttributeName(attribute.name);
    if (
      attributeName === null ||
      attributeNames.has(attributeName) ||
      NATIVE_SELF_BLUR_REFUSED_ATTRIBUTE_NAMES.has(attributeName)
    ) {
      return false;
    }
    attributeNames.add(attributeName);
  }
  if (
    getAuthoritativeJsxAttribute(openingElement.attributes, "onMouseOut") !== handlerAttribute ||
    !isNodeOfType(handlerAttribute.value, "JSXExpressionContainer")
  ) {
    return false;
  }
  const callback = stripParenExpression(handlerAttribute.value.expression);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== NATIVE_SELF_BLUR_SINGLE_PARAMETER_COUNT
  ) {
    return false;
  }
  const parameter = callback.params[0];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const call = stripParenExpression(callback.body);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== NATIVE_SELF_BLUR_ARGUMENT_COUNT
  ) {
    return false;
  }
  const method = stripParenExpression(call.callee);
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.computed ||
    method.optional ||
    !isNodeOfType(method.property, "Identifier") ||
    method.property.name !== "blur"
  ) {
    return false;
  }
  const target = stripParenExpression(method.object);
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(target.property, "Identifier") ||
    target.property.name !== "currentTarget"
  ) {
    return false;
  }
  const receiver = stripParenExpression(target.object);
  if (
    !isNodeOfType(receiver, "Identifier") ||
    context.scopes.symbolFor(receiver)?.bindingIdentifier !== parameter
  ) {
    return false;
  }
  const sourceText = context.sourceCode?.getText?.();
  return Boolean(
    sourceText !== undefined &&
    !hasJsxRuntimePragma({
      program: context.scopes.rootScope.node,
      filename: context.filename ?? "source.tsx",
      sourceText,
    }) &&
    hasStableNativeBlurProvider(context),
  );
};
