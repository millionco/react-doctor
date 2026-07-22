import {
  FLASH_LIST_V2_MAJOR,
  RECYCLABLE_LIST_PACKAGE_SOURCES,
} from "../../constants/react-native.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getReactDoctorNumberSetting } from "../../utils/get-react-doctor-setting.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";
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

const collectReturnedJsxRootNames = (expression: EsTreeNode, names: Set<string>): void => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "JSXElement")) {
    const elementName = getJsxElementQualifiedName(unwrappedExpression.openingElement.name);
    if (elementName) names.add(elementName);
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

const resolveRenderItemFunction = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): EsTreeNode | null => {
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(attribute.value.expression);
  if (
    isNodeOfType(expression, "ArrowFunctionExpression") ||
    isNodeOfType(expression, "FunctionExpression")
  ) {
    return expression;
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const binding = findVariableInitializer(attribute, expression.name);
  const initializer = binding?.initializer;
  if (
    initializer &&
    (isNodeOfType(initializer, "ArrowFunctionExpression") ||
      isNodeOfType(initializer, "FunctionExpression") ||
      isNodeOfType(initializer, "FunctionDeclaration"))
  ) {
    return initializer;
  }
  return null;
};

const renderItemHasHeterogeneousRootTypes = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  const renderItemFunction = resolveRenderItemFunction(attribute);
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

const isFlashListV2OrNewer = (context: RuleContext): boolean => {
  const flashListMajorVersion = getReactDoctorNumberSetting(
    context.settings,
    "shopifyFlashListMajorVersion",
  );
  return flashListMajorVersion !== undefined && flashListMajorVersion >= FLASH_LIST_V2_MAJOR;
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
          renderItemHasHeterogeneousRootTypes(renderItemAttribute)
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
