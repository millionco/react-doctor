import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { RECYCLABLE_LIST_PACKAGE_SOURCES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
import { isFlashListV2OrNewer } from "./utils/is-flash-list-v2-or-newer.js";
import { resolveImportedRecyclerName } from "./utils/resolve-imported-recycler-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getJsxElementQualifiedName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "JSXIdentifier")) return node.name;
  if (!isNodeOfType(node, "JSXMemberExpression")) return null;
  const objectName = getJsxElementQualifiedName(node.object);
  if (!objectName || !isNodeOfType(node.property, "JSXIdentifier")) return null;
  return `${objectName}.${node.property.name}`;
};

const getStaticRenderedRootNames = (node: EsTreeNode): ReadonlyArray<string> | null => {
  if (isNodeOfType(node, "JSXElement")) {
    const elementName = getJsxElementQualifiedName(node.openingElement.name);
    return elementName === null ? null : [elementName];
  }
  if (isNodeOfType(node, "JSXFragment")) {
    const rootNames: string[] = [];
    for (const child of node.children) {
      const childRootNames = getStaticRenderedRootNames(child);
      if (childRootNames === null) return null;
      rootNames.push(...childRootNames);
    }
    return rootNames;
  }
  if (isNodeOfType(node, "JSXText")) return node.value?.trim() ? null : [];
  if (!isNodeOfType(node, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(node.expression);
  if (isNodeOfType(expression, "JSXEmptyExpression")) return [];
  if (
    isNodeOfType(expression, "Literal") &&
    (expression.value === null || typeof expression.value === "boolean")
  ) {
    return [];
  }
  return getStaticRenderedRootNames(expression);
};

const getJsxFragmentRootName = (fragment: EsTreeNodeOfType<"JSXFragment">): string | null => {
  const childRootNames = getStaticRenderedRootNames(fragment);
  if (childRootNames === null) return null;
  if (childRootNames.length === 1) return childRootNames[0];
  return `fragment:${JSON.stringify(childRootNames)}`;
};

const collectReturnedJsxRootNames = (expression: EsTreeNode, names: Set<string>): void => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "JSXElement")) {
    const elementName = getJsxElementQualifiedName(unwrappedExpression.openingElement.name);
    if (elementName) names.add(elementName);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "JSXFragment")) {
    const fragmentRootName = getJsxFragmentRootName(unwrappedExpression);
    if (fragmentRootName) names.add(fragmentRootName);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    collectReturnedJsxRootNames(unwrappedExpression.consequent, names);
    collectReturnedJsxRootNames(unwrappedExpression.alternate, names);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    collectReturnedJsxRootNames(unwrappedExpression.left, names);
    collectReturnedJsxRootNames(unwrappedExpression.right, names);
  }
};

const resolveFunctionFromInitializer = (
  initializer: EsTreeNode,
  resultSymbol: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  const expression = stripParenExpression(initializer);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration")
  ) {
    return expression;
  }
  const callbackArgument = getTransparentReactCallbackWrapperArgument(
    expression,
    resultSymbol,
    scopes,
  );
  if (
    callbackArgument &&
    (isNodeOfType(callbackArgument, "ArrowFunctionExpression") ||
      isNodeOfType(callbackArgument, "FunctionExpression"))
  ) {
    return callbackArgument;
  }
  return null;
};

const resolveRenderItemFunction = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  const directFunction = resolveFunctionFromInitializer(expression, null, scopes);
  if (directFunction) return directFunction;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = scopes.symbolFor(expression);
  if (!symbol?.initializer) return null;
  return resolveFunctionFromInitializer(symbol.initializer, symbol, scopes);
};

const renderItemHasHeterogeneousRootTypes = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  scopes: ScopeAnalysis,
): boolean => {
  const renderItemFunction = resolveRenderItemFunction(attribute, scopes);
  if (
    !renderItemFunction ||
    (!isNodeOfType(renderItemFunction, "ArrowFunctionExpression") &&
      !isNodeOfType(renderItemFunction, "FunctionExpression") &&
      !isNodeOfType(renderItemFunction, "FunctionDeclaration"))
  ) {
    return false;
  }
  const returnedRootNames = new Set<string>();
  if (!isNodeOfType(renderItemFunction.body, "BlockStatement")) {
    collectReturnedJsxRootNames(renderItemFunction.body, returnedRootNames);
  } else {
    walkAst(renderItemFunction.body, (child) => {
      if (
        isNodeOfType(child, "ArrowFunctionExpression") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "FunctionDeclaration")
      ) {
        return false;
      }
      if (isNodeOfType(child, "ReturnStatement") && child.argument) {
        collectReturnedJsxRootNames(child.argument, returnedRootNames);
      }
    });
  }
  return returnedRootNames.size > 1;
};

export const rnListRecyclableWithoutTypes = defineRule({
  id: "rn-list-recyclable-without-types",
  title: "Recyclable list missing getItemType",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "When rows have different shapes, reused cells can show the wrong layout. Add `getItemType={item => item.kind}` so FlashList keeps a separate pool per row type.",
  create: (context: RuleContext) => {
    let fileImportsRecycler = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileImportsRecycler = hasImportFromModules(node, RECYCLABLE_LIST_PACKAGE_SOURCES);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!fileImportsRecycler) return;
        const elementName = resolveJsxElementName(node);
        if (!elementName) return;
        // Resolve the LOCAL JSX name back to a recycler that was really imported
        // from `@shopify/flash-list` / `@legendapp/list` — named, aliased, or
        // namespace member access. A name-only match on a homegrown `FlashList`
        // (`const FlashList = MyOwnList`) isn't a recycler.
        const canonicalRecyclerName = resolveImportedRecyclerName(node, elementName, {
          allowNamespaceMemberAccess: true,
        });
        if (canonicalRecyclerName === null) return;

        let hasRecycleItemsEnabled =
          canonicalRecyclerName === "FlashList" && isFlashListV2OrNewer(context);
        let hasGetItemType = false;
        let renderItemAttribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;

        for (const attr of node.attributes ?? []) {
          if (!isNodeOfType(attr, "JSXAttribute")) continue;
          if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
          if (attr.name.name === "recycleItems") {
            if (!attr.value) {
              hasRecycleItemsEnabled = true;
            } else if (
              isNodeOfType(attr.value, "JSXExpressionContainer") &&
              isNodeOfType(attr.value.expression, "Literal")
            ) {
              hasRecycleItemsEnabled = attr.value.expression.value === true;
            } else {
              hasRecycleItemsEnabled = true;
            }
          }
          if (attr.name.name === "getItemType") hasGetItemType = true;
          if (attr.name.name === "renderItem") renderItemAttribute = attr;
        }

        if (
          hasRecycleItemsEnabled &&
          !hasGetItemType &&
          renderItemAttribute &&
          renderItemHasHeterogeneousRootTypes(renderItemAttribute, context.scopes)
        ) {
          context.report({
            node,
            message: `Your users see rows of different shapes reuse the wrong cells when <${elementName}> recycles them without \`getItemType\`.`,
          });
        }
      },
    };
  },
});
