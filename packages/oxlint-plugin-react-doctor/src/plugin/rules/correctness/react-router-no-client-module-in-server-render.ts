import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const CLIENT_MODULE_PATTERN = /(?:^|\/)[^/]+\.client(?:\.[^/]*)?$/;
const CLIENT_ENTRY_PATTERN = /(?:^|\/)entry\.client\.[cm]?[jt]sx?$/;
const CLIENT_ONLY_FILE_PATTERN = /\.client\.[cm]?[jt]sx?$/;
const EMPTY_VISITORS: RuleVisitors = {};

export const reactRouterNoClientModuleInServerRender = wrapReactRouterRule(
  defineRule({
    id: "react-router-no-client-module-in-server-render",
    title: "Client-only module rendered on the server",
    tags: ["test-noise", "react-jsx-only"],
    requires: ["react-router:7", "react-router-framework"],
    severity: "error",
    recommendation:
      "Move client-only behavior behind a hydration boundary instead of importing a .client module into server-rendered JSX.",
    create: (context: RuleContext) => {
      if (
        context.filename &&
        (CLIENT_ENTRY_PATTERN.test(context.filename) ||
          CLIENT_ONLY_FILE_PATTERN.test(context.filename))
      ) {
        return EMPTY_VISITORS;
      }
      return {
        JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
          if (!isNodeOfType(node.name, "JSXIdentifier")) return;
          if (context.scopes.symbolFor(node.name)?.kind !== "import") return;
          const binding = getImportBindingForName(node.name, node.name.name);
          if (binding === null || !CLIENT_MODULE_PATTERN.test(binding.source)) return;
          context.report({
            node,
            message: `Component from '${binding.source}' is rendered on the server even though its module is client-only.`,
          });
        },
      };
    },
  }),
);
