import {
  PUBLIC_CLIENT_KEY_PATTERNS,
  SECRET_FALSE_POSITIVE_SUFFIXES,
  SECRET_MIN_LENGTH_CHARS,
  SECRET_PATTERNS,
  SECRET_VARIABLE_PATTERN,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { classifySecretFileExposure } from "../../utils/classify-secret-file-exposure.js";
import { getIdentifierTrailingWord } from "../../utils/get-identifier-trailing-word.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isInsideServerOnlyScope } from "../../utils/is-inside-server-only-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noSecretsInClientCode = defineRule<Rule>({
  id: "no-secrets-in-client-code",
  severity: "warn",
  recommendation:
    "Move secrets to server-only code. Public client environment variables are bundled into browser code and must not contain secrets",
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
    const framework = getReactDoctorStringSetting(context.settings, "framework");
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    let shouldUseVariableNameHeuristic =
      classifySecretFileExposure(filename, { framework, rootDirectory }) === "client";

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        shouldUseVariableNameHeuristic =
          classifySecretFileExposure(filename, {
            framework,
            hasUseClientDirective: hasDirective(programNode, "use client"),
            hasUseServerDirective: hasDirective(programNode, "use server"),
            rootDirectory,
          }) === "client";
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isNodeOfType(node.init, "Literal") || typeof node.init.value !== "string") return;

        const variableName = node.id.name;
        const literalValue = node.init.value;

        // Known public, client-safe keys (RevenueCat `appl_`, Stripe/Clerk
        // publishable `pk_`, Supabase `sb_publishable_`, Mapbox `pk.`,
        // PostHog `phc_`, Stytch `public-token-`) are designed to ship in the
        // browser bundle. Short-circuit before both detectors so an
        // intentionally-publishable literal is never reported as a leaked
        // secret — neither the variable-name heuristic nor the secret-shape
        // patterns should fire on it.
        if (PUBLIC_CLIENT_KEY_PATTERNS.some((pattern) => pattern.test(literalValue))) {
          return;
        }

        const isServerOnlyScope = isInsideServerOnlyScope(node);

        const trailingSuffix = getIdentifierTrailingWord(variableName);
        const isUiConstant = SECRET_FALSE_POSITIVE_SUFFIXES.has(trailingSuffix);

        if (
          shouldUseVariableNameHeuristic &&
          !isServerOnlyScope &&
          SECRET_VARIABLE_PATTERN.test(variableName) &&
          !isUiConstant &&
          literalValue.length > SECRET_MIN_LENGTH_CHARS
        ) {
          context.report({
            node,
            message: `Possible hardcoded secret in "${variableName}" — use environment variables instead`,
          });
          return;
        }

        if (SECRET_PATTERNS.some((pattern) => pattern.test(literalValue))) {
          context.report({
            node,
            message: "Hardcoded secret detected — use environment variables instead",
          });
        }
      },
    };
  },
});
