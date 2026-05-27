import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const PROPS_NAME_PATTERN = /[pP]rops/;
const isPropsLikeName = (identifierName: string): boolean =>
  PROPS_NAME_PATTERN.test(identifierName);

// Port of `solid/no-proxy-apis` — disables Proxy-dependent APIs for
// targets that don't support ES6 Proxy (legacy browsers, low-memory
// embedded JS engines). Off by default; opt in via severityControls
// when targeting a constrained environment. Trace-back to the
// variable initializer is left as a future improvement — we only
// inspect inline expressions here, matching the spirit of the
// upstream rule without the cross-module scope walk.
export const solidNoProxyApis = defineRule<Rule>({
  id: "solid-no-proxy-apis",
  severity: "warn",
  requires: ["solid"],
  defaultEnabled: false,
  recommendation:
    "Avoid Solid's Proxy-based APIs (`createStore`, `mergeProps`-with-function, JSX spread with member/call) on targets without ES6 Proxy support.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
        if (node.source.value === "solid-js/store") {
          context.report({
            node,
            message:
              "Solid Store APIs use Proxies, which are incompatible with your target environment.",
          });
        }
      },
      JSXSpreadAttribute(node: EsTreeNodeOfType<"JSXSpreadAttribute">) {
        const argument = node.argument;
        if (isNodeOfType(argument, "MemberExpression")) {
          context.report({
            node: argument,
            message:
              "Using a property access in JSX spread makes Solid use Proxies, which are incompatible with your target environment.",
          });
        } else if (isNodeOfType(argument, "CallExpression")) {
          context.report({
            node: argument,
            message:
              "Using a function call in JSX spread makes Solid use Proxies, which are incompatible with your target environment.",
          });
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isNodeOfType(node.callee, "Identifier")) {
          if (importTracker.matchImport(["mergeProps"], node.callee.name)) {
            for (const argument of node.arguments) {
              if (isNodeOfType(argument, "SpreadElement")) {
                context.report({
                  node: argument,
                  message:
                    "Passing a function (or spread) to `mergeProps` creates a Proxy, which is incompatible with your target environment.",
                });
                continue;
              }
              if (isFunctionLike(argument)) {
                context.report({
                  node: argument,
                  message:
                    "Passing a function to `mergeProps` creates a Proxy, which is incompatible with your target environment.",
                });
                continue;
              }
              if (isNodeOfType(argument, "Identifier") && !isPropsLikeName(argument.name)) {
                context.report({
                  node: argument,
                  message:
                    "Passing a non-props identifier to `mergeProps` may create a Proxy, which is incompatible with your target environment.",
                });
              }
            }
          }
          return;
        }
        if (isNodeOfType(node.callee, "MemberExpression")) {
          const callee = node.callee;
          if (
            isNodeOfType(callee.object, "Identifier") &&
            callee.object.name === "Proxy" &&
            isNodeOfType(callee.property, "Identifier") &&
            callee.property.name === "revocable"
          ) {
            context.report({
              node,
              message: "Proxies are incompatible with your target environment.",
            });
          }
        }
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "Proxy") {
          context.report({
            node,
            message: "Proxies are incompatible with your target environment.",
          });
        }
      },
    };
  },
});
