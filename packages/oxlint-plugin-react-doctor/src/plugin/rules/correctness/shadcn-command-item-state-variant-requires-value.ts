import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveShadcnUiComponentName } from "../../utils/resolve-shadcn-ui-component-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { walkAst } from "../../utils/walk-ast.js";

const CMDK_MODULE = "cmdk";
const CMDK_MODULE_PATTERN = /^cmdk$/;
const COMMAND_MODULE_PATTERN = /(?:^|\/)ui\/(?:.*\/)?command$|^\.\.?\/(?:.*\/)?command$/;

// Matches a presence-only Tailwind data variant for the two boolean states —
// `data-[selected]:` / `data-[disabled]:` — anywhere in a token's variant
// chain. cmdk renders those attributes on every item as `"true"` OR
// `"false"`, so a presence selector matches both values and the style
// applies to every item unconditionally.
const PRESENCE_STATE_VARIANT_PATTERN = /(?:^|:)data-\[(selected|disabled)\](?=:)/;

const isCmdkValueImport = (symbol: SymbolDescriptor): boolean => {
  if (symbol.kind !== "import") return false;
  const declaration = symbol.declarationNode.parent;
  return Boolean(
    declaration &&
    isNodeOfType(declaration, "ImportDeclaration") &&
    !isTypeOnlyImport(declaration) &&
    declaration.source.value === CMDK_MODULE,
  );
};

// cmdk item spellings beyond what the shared resolver covers (`<CommandItem>`
// named import, `<Cmdk.CommandItem>` namespace member): `<Command.Item>` off
// the named `Command` object import and `<Cmdk.Command.Item>` off a
// namespace import.
const isCmdkItemElement = (elementName: EsTreeNode, context: RuleContext): boolean => {
  if (resolveShadcnUiComponentName(elementName, CMDK_MODULE_PATTERN, context) === "CommandItem") {
    return true;
  }
  if (!isNodeOfType(elementName, "JSXMemberExpression") || elementName.property.name !== "Item") {
    return false;
  }
  if (isNodeOfType(elementName.object, "JSXIdentifier")) {
    const symbol = resolveConstIdentifierAlias(elementName.object, context.scopes);
    return Boolean(
      symbol && isCmdkValueImport(symbol) && getImportedName(symbol.declarationNode) === "Command",
    );
  }
  if (
    !isNodeOfType(elementName.object, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object.object, "JSXIdentifier") ||
    elementName.object.property.name !== "Command"
  ) {
    return false;
  }
  const namespaceSymbol = resolveConstIdentifierAlias(elementName.object.object, context.scopes);
  return Boolean(
    namespaceSymbol &&
    isCmdkValueImport(namespaceSymbol) &&
    isNodeOfType(namespaceSymbol.declarationNode, "ImportNamespaceSpecifier"),
  );
};

const isCommandItemElement = (elementName: EsTreeNode, context: RuleContext): boolean =>
  isCmdkItemElement(elementName, context) ||
  resolveShadcnUiComponentName(elementName, COMMAND_MODULE_PATTERN, context) === "CommandItem";

interface PresenceVariantUse {
  literalNode: EsTreeNode;
  state: string;
  token: string;
}

const findPresenceVariantUse = (
  text: string,
  literalNode: EsTreeNode,
): PresenceVariantUse | null => {
  for (const token of splitTailwindClassName(text)) {
    const match = PRESENCE_STATE_VARIANT_PATTERN.exec(token);
    if (match?.[1]) return { literalNode, state: match[1], token };
  }
  return null;
};

// Collects every statically-written class string reachable from the
// className attribute — a plain string, or string literals and template
// chunks anywhere inside the expression (`cn("…", className)`, cva config,
// clsx object keys, conditional branches).
const findPresenceVariantUseInClassName = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): PresenceVariantUse | null => {
  const value = attribute.value;
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") {
    return findPresenceVariantUse(value.value, value);
  }
  let use: PresenceVariantUse | null = null;
  walkAst(value, (node) => {
    if (use) return false;
    if (isNodeOfType(node, "Literal") && typeof node.value === "string") {
      use = findPresenceVariantUse(node.value, node);
    } else if (isNodeOfType(node, "TemplateLiteral")) {
      for (const quasi of node.quasis) {
        use ??= findPresenceVariantUse(quasi.value.cooked ?? quasi.value.raw ?? "", node);
      }
    }
  });
  return use;
};

export const shadcnCommandItemStateVariantRequiresValue = defineRule({
  id: "shadcn-command-item-state-variant-requires-value",
  title: "Command item styled by presence-only state variant",
  severity: "warn",
  category: "Correctness",
  requires: ["shadcn"],
  matchByOccurrence: true,
  recommendation:
    'Style command items with the value-aware variants data-[selected=true]: and data-[disabled=true]:, because cmdk renders both attributes on every item as "true" or "false".',
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isCommandItemElement(node.name, context)) return;
      const classNameAttribute = findJsxAttribute(node.attributes, "className");
      if (!classNameAttribute) return;
      const use = findPresenceVariantUseInClassName(classNameAttribute);
      if (!use) return;
      context.report({
        node: use.literalNode,
        message: `cmdk renders data-${use.state} on every command item as "true" or "false", so "${use.token}" matches both values and styles every item. Use data-[${use.state}=true]: instead.`,
      });
    },
  }),
});
