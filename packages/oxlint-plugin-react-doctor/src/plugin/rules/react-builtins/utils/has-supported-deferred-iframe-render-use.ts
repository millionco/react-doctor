import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { REF_NOTIFICATION_INACTIVE_ATTRIBUTES } from "../../state-and-effects/utils/constants.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { readConstantBoolean } from "../../../utils/read-constant-boolean.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { isRefNotificationNativeElement } from "../../state-and-effects/utils/is-ref-notification-native-element.js";
import {
  DEFERRED_IFRAME_MAX_RENDER_FORWARDING_DEPTH,
  DEFERRED_IFRAME_INACTIVE_RENDER_TAGS,
  DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT,
} from "./constants.js";

interface DeferredIframeRenderProof {
  readonly isExportedFunction: (functionNode: EsTreeNode, module: SourceProjectModule) => boolean;
  readonly moduleForNode: (node: EsTreeNode) => SourceProjectModule | null;
  readonly componentUses: (
    functionNode: EsTreeNode,
    module: SourceProjectModule,
  ) => ReadonlyArray<EsTreeNodeOfType<"JSXElement">> | null;
  readonly forwardedRoot: (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: SourceProjectModule,
  ) => {
    readonly module: SourceProjectModule;
    readonly root: EsTreeNodeOfType<"JSXElement">;
  } | null;
  readonly supportedMap: (
    invocation: EsTreeNodeOfType<"CallExpression">,
    module: SourceProjectModule,
  ) => boolean;
  readonly passiveCapture: (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: SourceProjectModule,
  ) => boolean;
}

export const hasSupportedDeferredIframeRenderUse = (
  node: EsTreeNode,
  module: SourceProjectModule,
  proof: DeferredIframeRenderProof,
): boolean => {
  const activeFunctions = new Set<EsTreeNode>();
  const visit = (
    start: EsTreeNode,
    ownerModule: SourceProjectModule,
    depth: number,
    htmlIntegration: boolean,
  ): boolean => {
    if (depth >= DEFERRED_IFRAME_MAX_RENDER_FORWARDING_DEPTH) return false;
    let cursor: EsTreeNode | null | undefined = start;
    let hasHtmlIntegration = htmlIntegration;
    while (cursor?.parent) {
      const parent: EsTreeNode = cursor.parent;
      if (isNodeOfType(parent, "JSXElement")) {
        if (parent.openingElement !== cursor && !parent.children.some((child) => child === cursor))
          return false;
        const opening = parent.openingElement;
        const name = resolveJsxElementType(opening);
        if (
          opening.attributes.some(
            (attribute) =>
              isNodeOfType(attribute, "JSXSpreadAttribute") ||
              (isNodeOfType(attribute, "JSXAttribute") &&
                REF_NOTIFICATION_INACTIVE_ATTRIBUTES.has(
                  getJsxAttributeName(attribute.name) ?? "",
                )),
          ) ||
          !proof.passiveCapture(opening, ownerModule)
        )
          return false;
        if (name === "svg") {
          if (!hasHtmlIntegration) return false;
          hasHtmlIntegration = false;
        } else if (name === "foreignObject") {
          if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
            return false;
          hasHtmlIntegration = true;
        } else if (name === "math") {
          return false;
        } else if (isNodeOfType(opening.name, "JSXMemberExpression")) {
          const object = opening.name.object;
          const symbol = isNodeOfType(object, "JSXIdentifier")
            ? ownerModule.scopes.symbolFor(object)
            : null;
          const imported = symbol && getValueImportDeclaration(symbol);
          if (
            opening.name.property.name !== "StrictMode" ||
            !symbol ||
            !isNodeOfType(imported, "ImportDeclaration") ||
            imported.source.value !== "react" ||
            (!isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
              !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
              getImportedName(symbol.declarationNode) !== "default") ||
            opening.attributes.length !== 0
          )
            return false;
        } else if (/^[a-z]/u.test(name)) {
          if (
            DEFERRED_IFRAME_INACTIVE_RENDER_TAGS.has(name) ||
            !isRefNotificationNativeElement(parent, ownerModule.scopes, true) ||
            !proof.passiveCapture(opening, ownerModule)
          )
            return false;
        } else {
          const forwarded = proof.forwardedRoot(opening, ownerModule);
          if (
            !forwarded ||
            !isRefNotificationNativeElement(forwarded.root, forwarded.module.scopes, true) ||
            !proof.passiveCapture(opening, ownerModule) ||
            !proof.passiveCapture(forwarded.root.openingElement, forwarded.module)
          )
            return false;
        }
      }
      if (isFunctionLike(parent)) {
        if (parent.async || ("generator" in parent && parent.generator)) return false;
        const uses = proof.componentUses(parent, ownerModule);
        if (!uses) {
          const invocation: EsTreeNode | null | undefined = parent.parent;
          if (
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.optional ||
            !isNodeOfType(invocation.callee, "MemberExpression") ||
            invocation.callee.optional ||
            invocation.callee.computed ||
            getStaticPropertyName(invocation.callee) !== "map" ||
            invocation.arguments[0] !== parent ||
            !proof.supportedMap(invocation, ownerModule)
          )
            return false;
          cursor = invocation;
          continue;
        }
        if (activeFunctions.has(parent)) return false;
        if (uses.length === 0) return proof.isExportedFunction(parent, ownerModule);
        activeFunctions.add(parent);
        const supported = uses.every((use) => {
          const useModule = proof.moduleForNode(use);
          return Boolean(useModule && visit(use, useModule, depth + 1, hasHtmlIntegration));
        });
        activeFunctions.delete(parent);
        return supported;
      }
      if (isNodeOfType(parent, "JSXFragment")) {
        if (!parent.children.some((child) => child === cursor)) return false;
      } else if (isNodeOfType(parent, "JSXExpressionContainer")) {
        if (parent.expression !== cursor) return false;
      } else if (isNodeOfType(parent, "ConditionalExpression")) {
        const condition = readConstantBoolean(parent.test, ownerModule.scopes);
        if (
          parent.test === cursor ||
          (parent.consequent === cursor && condition === false) ||
          (parent.alternate === cursor && condition === true)
        )
          return false;
      } else if (isNodeOfType(parent, "LogicalExpression")) {
        if (
          parent.operator !== "&&" ||
          parent.right !== cursor ||
          readConstantBoolean(parent.left, ownerModule.scopes) === false
        )
          return false;
      } else if (isNodeOfType(parent, "ReturnStatement")) {
        if (parent.argument !== cursor) return false;
      } else if (isNodeOfType(parent, "BlockStatement")) {
        if (
          !isNodeOfType(cursor, "ReturnStatement") ||
          !isFunctionLike(parent.parent) ||
          parent.parent.body !== parent
        )
          return false;
      } else if (isNodeOfType(parent, "CallExpression")) {
        const callee = parent.callee;
        const receiver = isNodeOfType(callee, "MemberExpression") ? callee.object : null;
        const symbol =
          receiver && isNodeOfType(receiver, "Identifier")
            ? ownerModule.scopes.symbolFor(receiver)
            : null;
        const imported = symbol && getValueImportDeclaration(symbol);
        const statement = parent.parent;
        return Boolean(
          !parent.optional &&
          isNodeOfType(callee, "MemberExpression") &&
          !callee.optional &&
          !callee.computed &&
          getStaticPropertyName(callee) === "render" &&
          parent.arguments.length === DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT &&
          parent.arguments[0] === cursor &&
          isNodeOfType(imported, "ImportDeclaration") &&
          imported.source.value === "react-dom" &&
          symbol &&
          (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
            isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) &&
          isNodeOfType(statement, "ExpressionStatement") &&
          statement.expression === parent &&
          isNodeOfType(statement.parent, "Program"),
        );
      } else if (!isNodeOfType(parent, "JSXElement") && stripParenExpression(parent) !== cursor) {
        return false;
      }
      cursor = parent;
    }
    return false;
  };
  return visit(node, module, 0, false);
};
