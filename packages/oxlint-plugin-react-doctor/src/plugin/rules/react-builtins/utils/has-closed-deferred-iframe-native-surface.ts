import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  DEFERRED_IFRAME_CAPABILITY_MEMBERS,
  DEFERRED_IFRAME_CAPABILITY_NAMES,
  DEFERRED_IFRAME_DOCUMENT_METHODS,
  DEFERRED_IFRAME_FORBIDDEN_NODES,
  DEFERRED_IFRAME_GLOBAL_NAMES,
  DEFERRED_IFRAME_REACT_HOOK_NAMES,
  DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT,
  DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT,
  DEFERRED_IFRAME_WINDOW_METHODS,
} from "./constants.js";

interface DeferredIframeSurfaceModule extends SourceProjectModule {
  readonly sourceText: string;
}

import { HTML_TAGS } from "../../../constants/html-tags.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
const directMemberName = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "MemberExpression") && !node.computed && !node.optional
    ? getStaticPropertyName(node)
    : null;
const directCall = (node: EsTreeNode | null | undefined, name: string) =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  directMemberName(node.callee) === name &&
  node.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? node
    : null;
const isNativeElement = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  HTML_TAGS.has(resolveJsxElementType(opening)) &&
  !getAuthoritativeJsxAttribute(opening.attributes, "is");
const attributeValue = (opening: EsTreeNodeOfType<"JSXOpeningElement">, name: string) => {
  if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    return null;
  const value = getAuthoritativeJsxAttribute(opening.attributes, name)?.value;
  return isNodeOfType(value, "JSXExpressionContainer") ? value.expression : (value ?? null);
};

export const hasClosedDeferredIframeNativeSurface = (
  module: DeferredIframeSurfaceModule,
  className: string,
  hasClosedNativeRef: (identifier: EsTreeNode) => boolean,
  getReadonlySymbol: (identifier: EsTreeNode) => SymbolDescriptor | null,
): boolean => {
  const readonlyInitializer = (identifier: EsTreeNode): EsTreeNode | null => {
    const symbol = getReadonlySymbol(identifier);
    const declaration = symbol?.declarationNode;
    return symbol?.kind === "const" &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      declaration.id === symbol.bindingIdentifier &&
      declaration.init
      ? stripParenExpression(declaration.init)
      : null;
  };
  const closedReactImports = (module: DeferredIframeSurfaceModule): boolean =>
    module.scopes.rootScope.symbols.every((symbol) => {
      const declaration = getValueImportDeclaration(symbol);
      if (!isNodeOfType(declaration, "ImportDeclaration")) return true;
      if (
        ["preact", "react/jsx-runtime", "react/jsx-dev-runtime"].includes(
          String(declaration.source.value),
        )
      )
        return false;
      if (declaration.source.value !== "react") return true;
      if (!getReadonlySymbol(symbol.bindingIdentifier)) return false;
      const importedName = getImportedName(symbol.declarationNode);
      const namespace =
        isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
        isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
        importedName === "default";
      return symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const parent = reference.identifier.parent;
        if (namespace)
          return (
            isNodeOfType(parent, "JSXMemberExpression") &&
            parent.object === reference.identifier &&
            parent.property.name === "StrictMode" &&
            (isNodeOfType(parent.parent, "JSXOpeningElement") ||
              isNodeOfType(parent.parent, "JSXClosingElement"))
          );
        return Boolean(
          importedName &&
          DEFERRED_IFRAME_REACT_HOOK_NAMES.has(importedName) &&
          isNodeOfType(parent, "CallExpression") &&
          parent.callee === reference.identifier &&
          !parent.optional &&
          isProvenUnmodifiedReactApiCall(parent, importedName, module.scopes),
        );
      });
    });
  const isMountContainer = (lookup: EsTreeNode, module: DeferredIframeSurfaceModule): boolean => {
    const invocation = lookup.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.arguments.length !== DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT ||
      invocation.arguments[1] !== lookup ||
      !isNodeOfType(invocation.arguments[0], "JSXElement") ||
      !isNodeOfType(invocation.callee, "MemberExpression") ||
      directMemberName(invocation.callee) !== "render" ||
      !isNodeOfType(invocation.callee.object, "Identifier")
    )
      return false;
    const selected = getReadonlySymbol(invocation.callee.object);
    const imported = selected && getValueImportDeclaration(selected);
    if (
      !selected ||
      !isNodeOfType(imported, "ImportDeclaration") ||
      imported.source.value !== "react-dom" ||
      !isNodeOfType(selected.declarationNode, "ImportDefaultSpecifier") ||
      resolveModulePath(module.filePath, "react-dom")
    )
      return false;
    return true;
  };
  const closedReactDomImports = (): boolean => {
    return module.scopes.rootScope.symbols.every((symbol) => {
      const declaration = getValueImportDeclaration(symbol);
      if (
        !isNodeOfType(declaration, "ImportDeclaration") ||
        declaration.source.value !== "react-dom"
      )
        return true;
      if (
        !getReadonlySymbol(symbol.bindingIdentifier) ||
        !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
      )
        return false;
      return symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        return Boolean(
          member &&
          directMemberName(member) === "render" &&
          isNodeOfType(member.parent, "CallExpression") &&
          member.parent.callee === member &&
          !member.parent.optional,
        );
      });
    });
  };

  const isNativeListener = (call: EsTreeNode | null | undefined): boolean => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT ||
      !isNodeOfType(call.arguments[0], "Literal") ||
      typeof call.arguments[0].value !== "string" ||
      !isNodeOfType(call.arguments[1], "Identifier")
    )
      return false;
    const callback = readonlyInitializer(call.arguments[1]);
    return Boolean(
      callback &&
      isFunctionLike(callback) &&
      !callback.async &&
      !("generator" in callback && callback.generator),
    );
  };

  if (
    !hasStandardReactJsxConfiguration(module.filePath) ||
    ["react", "react/jsx-runtime", "react/jsx-dev-runtime"].some((source) =>
      resolveModulePath(module.filePath, source),
    ) ||
    hasJsxRuntimePragma({
      program: module.programNode,
      filename: module.filePath,
      sourceText: module.sourceText,
    }) ||
    !closedReactImports(module) ||
    !closedReactDomImports()
  )
    return false;
  let valid = true;
  walkAst(module.programNode, (node) => {
    if (!valid) return false;
    if (
      DEFERRED_IFRAME_FORBIDDEN_NODES.has(node.type) ||
      (isNodeOfType(node, "CatchClause") &&
        node.param &&
        !isNodeOfType(node.param, "Identifier")) ||
      (isNodeOfType(node, "Property") && (node.computed || node.kind !== "init")) ||
      (isNodeOfType(node, "MethodDefinition") &&
        node.kind !== "method" &&
        node.kind !== "constructor")
    ) {
      valid = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "JSXOpeningElement")) {
      const ref = attributeValue(node, "ref");
      if (
        ref &&
        (!isNativeElement(node) || !isNodeOfType(ref, "Identifier") || !hasClosedNativeRef(ref))
      )
        valid = false;
    }
    if (
      (isNodeOfType(node, "JSXAttribute") &&
        isNodeOfType(node.name, "JSXIdentifier") &&
        node.name.name === "dangerouslySetInnerHTML") ||
      (isNodeOfType(node, "JSXOpeningElement") &&
        isNativeElement(node) &&
        node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    )
      valid = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, module.scopes);
      if (
        name &&
        DEFERRED_IFRAME_CAPABILITY_MEMBERS.has(name) &&
        !(name === "remove" && directMemberName(node.object) === "classList")
      )
        valid = false;
      if (
        name === "current" &&
        (!isNodeOfType(node.object, "Identifier") || !hasClosedNativeRef(node.object))
      )
        valid = false;
      if (
        node.computed &&
        name === null &&
        !(
          isNodeOfType(node.property, "Literal") &&
          typeof node.property.value === "number" &&
          Number.isSafeInteger(node.property.value) &&
          node.property.value >= 0
        ) &&
        !(
          isNodeOfType(node.parent, "TemplateLiteral") &&
          !isNodeOfType(node.parent.parent, "TaggedTemplateExpression") &&
          node.parent.expressions.some((expression) => expression === node)
        ) &&
        !(
          isNodeOfType(node.parent, "BinaryExpression") &&
          node.parent.operator === "+" &&
          ((isNodeOfType(node.parent.left, "Literal") &&
            typeof node.parent.left.value === "string") ||
            (isNodeOfType(node.parent.right, "Literal") &&
              typeof node.parent.right.value === "string"))
        )
      )
        valid = false;
      if (
        name &&
        (DEFERRED_IFRAME_DOCUMENT_METHODS.has(name) ||
          DEFERRED_IFRAME_WINDOW_METHODS.has(name) ||
          name === "setAttribute")
      ) {
        const invocation = node.parent;
        if (
          !isNodeOfType(invocation, "CallExpression") ||
          invocation.callee !== node ||
          invocation.optional
        )
          valid = false;
      }
      if (
        ["className", "id", "sandbox", "src", "srcDoc"].includes(name ?? "") &&
        isWithinAssignmentTarget(node)
      )
        valid = false;
      if (
        name === "classList" &&
        (!isNodeOfType(node.parent, "MemberExpression") || node.parent.object !== node)
      )
        valid = false;
      if (name === "innerHTML") {
        const assignment = node.parent;
        if (
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.left !== node ||
          assignment.operator !== "=" ||
          !isNodeOfType(assignment.right, "Literal") ||
          typeof assignment.right.value !== "string" ||
          /[<>&]/u.test(assignment.right.value)
        )
          valid = false;
      }
      const call = directCall(node.parent, "setAttribute");
      if (
        name === "setAttribute" &&
        (!call ||
          call.arguments.length !== DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT ||
          !isNodeOfType(call.arguments[0], "Literal") ||
          !["src", "height"].includes(String(call.arguments[0].value)))
      )
        valid = false;
      if (
        isNodeOfType(node.object, "MemberExpression") &&
        directMemberName(node.object) === "classList"
      ) {
        const call = node.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== node ||
          call.optional ||
          !["add", "remove", "toggle"].includes(name ?? "") ||
          call.arguments.some(
            (argument) =>
              !isNodeOfType(argument, "Literal") ||
              typeof argument.value !== "string" ||
              argument.value.split(/\s+/u).includes(className),
          )
        )
          valid = false;
      }
    }
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      isNonReferenceIdentifier(node)
    )
      return;
    if (DEFERRED_IFRAME_CAPABILITY_NAMES.has(node.name)) valid = false;
    const runtimeSymbol = module.scopes.symbolFor(node);
    if (runtimeSymbol && isErasedTypeScriptBinding(runtimeSymbol)) valid = false;
    if (module.scopes.isGlobalReference(node) && !DEFERRED_IFRAME_GLOBAL_NAMES.has(node.name)) {
      const call = node.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== node ||
        call.optional ||
        !isNodeOfType(call.parent, "AwaitExpression")
      )
        valid = false;
    }
    if (node.name === "console" && module.scopes.isGlobalReference(node)) {
      const member = node.parent;
      const call = member?.parent;
      if (
        !member ||
        !["log", "warn", "error"].includes(directMemberName(member) ?? "") ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional
      )
        valid = false;
    }
    if (node.name !== "document" && node.name !== "window") return;
    if (!module.scopes.referenceFor(node)) {
      if (node !== module.scopes.symbolFor(node)?.bindingIdentifier) valid = false;
      return;
    }
    const member = node.parent;
    const name = directMemberName(member);
    if (!module.scopes.isGlobalReference(node) || !name || !member) {
      valid = false;
      return;
    }
    const call = member.parent;
    const readScroll =
      node.name === "document" &&
      ["body", "documentElement"].includes(name) &&
      directMemberName(call) === "scrollTop" &&
      !isWithinAssignmentTarget(member);
    const methods =
      node.name === "document" ? DEFERRED_IFRAME_DOCUMENT_METHODS : DEFERRED_IFRAME_WINDOW_METHODS;
    if (
      name === "getElementById" &&
      (!isNodeOfType(call, "CallExpression") ||
        call.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
        !isNodeOfType(call.arguments[0], "Literal") ||
        typeof call.arguments[0].value !== "string" ||
        !isMountContainer(call, module))
    )
      valid = false;
    if (["addEventListener", "removeEventListener"].includes(name) && !isNativeListener(call))
      valid = false;
    if (
      !readScroll &&
      (!methods.has(name) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional ||
        call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")))
    )
      valid = false;
  });
  return valid;
};
