import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const SAFE_BUILD_ENV_VARS = new Set(["NODE_ENV", "MODE", "DEV", "PROD"]);

const SECRET_KEYWORD_PATTERN = /(?:secret|token|api[_]?key|password|private)/i;

// HACK: only flag env vars whose name matches a secret keyword. A loader
// reading process.env.DATABASE_URL or process.env.PORT is fine; what's not
// fine is process.env.STRIPE_SECRET or process.env.NEXT_PUBLIC_API_KEY (the
// latter being a misconfigured public-prefixed key).
const isLikelySecret = (envVarName: string): boolean => {
  if (SAFE_BUILD_ENV_VARS.has(envVarName)) return false;
  return SECRET_KEYWORD_PATTERN.test(envVarName);
};

export const tanstackStartNoSecretsInLoader = defineRule<Rule>({
  id: "tanstack-start-no-secrets-in-loader",
  requires: ["tanstack-start"],
  severity: "error",
  category: "Security",
  recommendation:
    "Loaders are isomorphic (run on both server and client). Wrap secret access in `createServerFn()` so it stays server-only",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader" && keyName !== "beforeLoad") continue;

        const loaderValue = isNodeOfType(property, "Property") ? property.value : property;
        walkAst(loaderValue, (child: EsTreeNode) => {
          if (!isNodeOfType(child, "MemberExpression")) return;
          const isProcessEnvAccess =
            isNodeOfType(child.object, "MemberExpression") &&
            isNodeOfType(child.object.object, "Identifier") &&
            child.object.object.name === "process" &&
            isNodeOfType(child.object.property, "Identifier") &&
            child.object.property.name === "env";
          const isImportMetaEnvAccess =
            isNodeOfType(child.object, "MemberExpression") &&
            isNodeOfType(child.object.object, "MetaProperty") &&
            isNodeOfType(child.object.property, "Identifier") &&
            child.object.property.name === "env";

          if (!isProcessEnvAccess && !isImportMetaEnvAccess) return;

          const envVarName = isNodeOfType(child.property, "Identifier")
            ? child.property.name
            : null;
          if (envVarName && isLikelySecret(envVarName)) {
            const envSource = isImportMetaEnvAccess ? "import.meta.env" : "process.env";
            context.report({
              node: child,
              message: `${envSource}.${envVarName} in ${keyName} — loaders are isomorphic and may leak secrets to the client. Move to a createServerFn()`,
            });
          }
        });
      }
    },
  }),
});
