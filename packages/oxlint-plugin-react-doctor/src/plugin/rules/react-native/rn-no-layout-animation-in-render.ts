import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { getFunctionBindingSymbols } from "../../utils/get-function-binding-symbols.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "../../utils/is-node-on-unconditional-path.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const LAYOUT_ANIMATION_SCHEDULING_METHODS: ReadonlySet<string> = new Set([
  "configureNext",
  "easeInEaseOut",
  "linear",
  "spring",
]);

interface LayoutAnimationRenderCandidate {
  node: EsTreeNodeOfType<"MemberExpression">;
  methodName: string;
}

export const rnNoLayoutAnimationInRender = defineRule({
  id: "rn-no-layout-animation-in-render",
  title: "Layout animation API is called during render",
  severity: "warn",
  category: "Correctness",
  requires: ["react-native"],
  defaultEnabled: false,
  tags: ["react-jsx-only"],
  recommendation:
    "Schedule the animation before the intended layout update in an event handler or effect.",
  create: (context: RuleContext) => {
    const candidates: LayoutAnimationRenderCandidate[] = [];
    let hasProviderExposure = false;

    return {
      ImportDeclaration: (node: EsTreeNodeOfType<"ImportDeclaration">) => {
        if (node.importKind === "type" || typeof node.source.value !== "string") return;
        if (node.source.value.startsWith("react-native/")) {
          hasProviderExposure = true;
          return;
        }
        if (node.source.value !== "react-native") return;
        for (const specifier of node.specifiers) {
          const provider = resolveImportedApiReference(specifier.local, context.scopes);
          if (provider?.isNamespace || provider?.importedName === "default") {
            hasProviderExposure = true;
          }
        }
      },
      ExportNamedDeclaration: (node: EsTreeNodeOfType<"ExportNamedDeclaration">) => {
        if (node.exportKind === "type" || !node.source || typeof node.source.value !== "string") {
          return;
        }
        if (
          node.source.value.startsWith("react-native/") ||
          (node.source.value === "react-native" &&
            !node.specifiers.every((specifier) => specifier.exportKind === "type"))
        ) {
          hasProviderExposure = true;
        }
      },
      ExportAllDeclaration: (node: EsTreeNodeOfType<"ExportAllDeclaration">) => {
        if (
          node.exportKind !== "type" &&
          typeof node.source.value === "string" &&
          (node.source.value === "react-native" || node.source.value.startsWith("react-native/"))
        ) {
          hasProviderExposure = true;
        }
      },
      ImportExpression: (node: EsTreeNodeOfType<"ImportExpression">) => {
        if (
          isNodeOfType(node.source, "Literal") &&
          typeof node.source.value === "string" &&
          (node.source.value === "react-native" || node.source.value.startsWith("react-native/"))
        ) {
          hasProviderExposure = true;
        }
      },
      Identifier: (node: EsTreeNodeOfType<"Identifier">) => {
        if (!context.scopes.referenceFor(node)) return;
        const provider = resolveImportedApiReference(node, context.scopes);
        if (provider?.source !== "react-native" || provider.importedName !== "LayoutAnimation") {
          return;
        }
        const expressionRoot = findTransparentExpressionRoot(node);
        const parent = expressionRoot.parent;
        if (!isNodeOfType(parent, "MemberExpression") || parent.object !== expressionRoot) {
          hasProviderExposure = true;
        }
      },
      MemberExpression: (node: EsTreeNodeOfType<"MemberExpression">) => {
        const provider = resolveImportedApiReference(node.object, context.scopes);
        if (provider?.source !== "react-native" || provider.importedName !== "LayoutAnimation") {
          return;
        }
        const expressionRoot = findTransparentExpressionRoot(node);
        const parent = expressionRoot.parent;
        if (
          (isNodeOfType(parent, "AssignmentExpression") && parent.left === expressionRoot) ||
          (isNodeOfType(parent, "UpdateExpression") && parent.argument === expressionRoot) ||
          (isNodeOfType(parent, "UnaryExpression") &&
            parent.operator === "delete" &&
            parent.argument === expressionRoot) ||
          isNodeOfType(parent, "ArrayPattern") ||
          (isNodeOfType(parent, "Property") &&
            parent.value === expressionRoot &&
            isNodeOfType(parent.parent, "ObjectPattern")) ||
          (isNodeOfType(parent, "RestElement") && parent.argument === expressionRoot) ||
          (isNodeOfType(parent, "AssignmentPattern") && parent.left === expressionRoot) ||
          ((isNodeOfType(parent, "ForInStatement") || isNodeOfType(parent, "ForOfStatement")) &&
            parent.left === expressionRoot)
        ) {
          hasProviderExposure = true;
        }
      },
      CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
        const callee = stripParenExpression(node.callee);
        if (
          isNodeOfType(callee, "Identifier") &&
          callee.name === "require" &&
          context.scopes.isGlobalReference(callee) &&
          isNodeOfType(node.arguments[0], "Literal") &&
          typeof node.arguments[0].value === "string" &&
          (node.arguments[0].value === "react-native" ||
            node.arguments[0].value.startsWith("react-native/"))
        ) {
          hasProviderExposure = true;
        }
        const receiverObject = isNodeOfType(callee, "MemberExpression")
          ? stripParenExpression(callee.object)
          : null;
        if (
          !isNodeOfType(callee, "MemberExpression") ||
          !isNodeOfType(receiverObject, "Identifier") ||
          node.optional ||
          callee.optional ||
          isNodeOfType(findTransparentExpressionRoot(node), "ChainExpression") ||
          context.scopes.symbolFor(receiverObject)?.kind !== "import"
        ) {
          return;
        }
        const methodName = getStaticPropertyName(callee);
        if (!methodName || !LAYOUT_ANIMATION_SCHEDULING_METHODS.has(methodName)) return;
        const provider = resolveImportedApiReference(receiverObject, context.scopes);
        if (provider?.source !== "react-native" || provider.importedName !== "LayoutAnimation") {
          return;
        }
        const component = context.cfg.enclosingFunction(node);
        if (
          !isFunctionLike(component) ||
          Boolean(findEnclosingClass(node)) ||
          component.async ||
          component.generator ||
          (isNodeOfType(component, "FunctionExpression") && Boolean(component.id)) ||
          node.range[0] < component.body.range[0] ||
          node.range[1] > component.body.range[1] ||
          !isComponentFunction(component) ||
          !isNodeOnUnconditionalPath(node, component.body) ||
          !isNodeReachableWithinFunction(node, context)
        ) {
          return;
        }
        const componentRoot = findTransparentExpressionRoot(component);
        const parent = componentRoot.parent;
        let declarationParent = parent;
        if (isNodeOfType(parent, "VariableDeclarator") && parent.init === componentRoot) {
          const declaration = parent.parent;
          if (!isNodeOfType(declaration, "VariableDeclaration")) return;
          declarationParent = declaration.parent;
        }
        if (
          !isNodeOfType(declarationParent, "Program") &&
          !isNodeOfType(declarationParent, "ExportNamedDeclaration") &&
          !isNodeOfType(declarationParent, "ExportDefaultDeclaration")
        ) {
          return;
        }
        if (
          getFunctionBindingSymbols(component, context.scopes).some((symbol) =>
            symbol.references.some((reference) => {
              const identifier = reference.identifier;
              const referenceParent = identifier.parent;
              return !(
                (isNodeOfType(identifier, "JSXIdentifier") &&
                  ((isNodeOfType(referenceParent, "JSXOpeningElement") &&
                    referenceParent.name === identifier) ||
                    (isNodeOfType(referenceParent, "JSXClosingElement") &&
                      referenceParent.name === identifier))) ||
                (isNodeOfType(referenceParent, "ExportDefaultDeclaration") &&
                  referenceParent.declaration === identifier) ||
                (isNodeOfType(referenceParent, "ExportSpecifier") &&
                  referenceParent.local === identifier)
              );
            }),
          ) ||
          !functionContainsReactRenderOutput(component, context.scopes, context.cfg)
        ) {
          return;
        }
        candidates.push({ node: callee, methodName });
      },
      "Program:exit": () => {
        if (hasProviderExposure) return;
        for (const candidate of candidates) {
          context.report({
            node: candidate.node,
            message: `LayoutAnimation.${candidate.methodName}() is called during render. Schedule the animation before the intended layout update in an event handler or effect.`,
          });
        }
      },
    };
  },
});
