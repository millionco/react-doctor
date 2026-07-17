import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import type { RuleContext } from "../../utils/rule-context.js";

const getTabsImportSource = (symbol: SymbolDescriptor): string | null => {
  if (symbol.kind !== "import") return null;
  const declaration = symbol.declarationNode.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  const source = declaration.source.value;
  return typeof source === "string" && (source === "tabs" || /(?:^|\/)tabs$/.test(source))
    ? source
    : null;
};

const isImportedTabsComponent = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  componentName: string,
  context: RuleContext,
): boolean => {
  const elementName = openingElement.name;
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(elementName, context.scopes);
    return Boolean(
      symbol &&
      getTabsImportSource(symbol) &&
      getImportedName(symbol.declarationNode) === componentName,
    );
  }
  if (
    !isNodeOfType(elementName, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object, "JSXIdentifier") ||
    elementName.property.name !== componentName
  ) {
    return false;
  }
  const symbol = resolveConstIdentifierAlias(elementName.object, context.scopes);
  return Boolean(
    symbol &&
    getTabsImportSource(symbol) &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const hasTabsListAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isImportedTabsComponent(ancestor.openingElement, "TabsList", context)
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const shadcnTabsTriggerRequiresList = defineRule({
  id: "shadcn-tabs-trigger-requires-list",
  title: "Tabs trigger is outside TabsList",
  severity: "warn",
  category: "Correctness",
  defaultEnabled: false,
  recommendation:
    "Render each imported TabsTrigger inside its library TabsList so keyboard navigation and tablist semantics share one scope.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isImportedTabsComponent(node, "TabsTrigger", context) ||
        hasTabsListAncestor(node, context)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This TabsTrigger is outside TabsList, so the library cannot provide the expected tablist grouping and keyboard behavior. Nest it inside TabsList.",
      });
    },
  }),
});
