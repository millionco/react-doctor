import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findNearestInkJsxElement } from "../../utils/find-nearest-ink-jsx-element.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isInsideInkJsxTree } from "../../utils/is-inside-ink-jsx-tree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const DOM_ROUTER_COMPONENT_NAMES = new Set(["BrowserRouter", "HashRouter", "Link", "NavLink"]);
const DOM_ROUTER_FACTORY_NAMES = new Set(["createBrowserRouter", "createHashRouter"]);
const ROUTER_MODULE_NAMES = ["react-router", "react-router-dom"];

const resolveRouterImportName = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isNodeOfType(node.name, "JSXIdentifier")) return null;
  if (scopes.symbolFor(node.name)?.kind !== "import") return null;
  for (const moduleName of ROUTER_MODULE_NAMES) {
    const importedName = getImportedNameFromModule(node, node.name.name, moduleName);
    if (importedName) return importedName;
  }
  return null;
};

export const inkNoDomRouter = defineRule({
  id: "ink-no-dom-router",
  title: "DOM router used in an Ink tree",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation: "Use React Router's memory router APIs in Ink applications.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const importedName = resolveRouterImportName(node, context.scopes);
      if (!importedName || !DOM_ROUTER_COMPONENT_NAMES.has(importedName)) return;
      if (!isInsideInkJsxTree(node.parent, context.scopes)) return;
      context.report({
        node,
        message: `\`${importedName}\` depends on DOM history; use a memory router with Ink.`,
      });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier")) return;
      if (context.scopes.symbolFor(node.callee)?.kind !== "import") return;
      const localName = node.callee.name;
      const importedName = ROUTER_MODULE_NAMES.map((moduleName) =>
        getImportedNameFromModule(node, localName, moduleName),
      ).find(Boolean);
      if (!importedName || !DOM_ROUTER_FACTORY_NAMES.has(importedName)) return;
      if (findNearestInkJsxElement(node, context.scopes) === null) return;
      context.report({
        node,
        message: `\`${importedName}\` requires a DOM; use \`createMemoryRouter\` with Ink.`,
      });
    },
  }),
});
