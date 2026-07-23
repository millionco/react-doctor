import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { RECYCLABLE_LIST_PACKAGE_SOURCES } from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../utils/get-transparent-react-callback-wrapper-argument.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
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

const getStaticRenderedRootNames = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  if (isNodeOfType(node, "JSXElement") && !isJsxFragmentElement(node.openingElement, scopes)) {
    const elementName = getJsxElementQualifiedName(node.openingElement.name);
    return elementName === null ? null : [elementName];
  }
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    const rootNames: string[] = [];
    for (const child of node.children) {
      const childRootNames = getStaticRenderedRootNames(child, scopes);
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
  return getStaticRenderedRootNames(expression, scopes);
};

const getRenderedRootName = (
  root: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
  scopes: ScopeAnalysis,
): string | null => {
  const childRootNames = getStaticRenderedRootNames(root, scopes);
  if (childRootNames === null) return null;
  if (childRootNames.length === 1) return childRootNames[0];
  return `fragment:${JSON.stringify(childRootNames)}`;
};

const collectReturnedJsxRootNames = (
  expression: EsTreeNode,
  names: Set<string>,
  scopes: ScopeAnalysis,
): void => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "JSXElement") ||
    isNodeOfType(unwrappedExpression, "JSXFragment")
  ) {
    const rootName = getRenderedRootName(unwrappedExpression, scopes);
    if (rootName) names.add(rootName);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    collectReturnedJsxRootNames(unwrappedExpression.consequent, names, scopes);
    collectReturnedJsxRootNames(unwrappedExpression.alternate, names, scopes);
    return;
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    collectReturnedJsxRootNames(unwrappedExpression.left, names, scopes);
    collectReturnedJsxRootNames(unwrappedExpression.right, names, scopes);
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
  const localFunction = resolveExactLocalFunction(expression, scopes);
  if (localFunction) return localFunction;
  const symbol = scopes.symbolFor(expression);
  if (symbol?.kind === "function") return null;
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
    collectReturnedJsxRootNames(renderItemFunction.body, returnedRootNames, scopes);
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
        collectReturnedJsxRootNames(child.argument, returnedRootNames, scopes);
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
    "When rows have different shapes, reused cells can show the wrong layout. Add `getItemType` that returns a stable type for each row shape so FlashList keeps separate recycling pools.",
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
