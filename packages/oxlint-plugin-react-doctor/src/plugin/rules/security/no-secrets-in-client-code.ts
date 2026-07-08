import {
  PUBLIC_CLIENT_KEY_PATTERNS,
  SECRET_FALSE_POSITIVE_SUFFIXES,
  SECRET_MIN_LENGTH_CHARS,
  SECRET_PLACEHOLDER_CONTEXT_PATTERN,
  SECRET_PATTERNS,
  SECRET_VARIABLE_PATTERN,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { classifySecretFileExposure } from "../../utils/classify-secret-file-exposure.js";
import { enclosingComponentOrHookName } from "../../utils/enclosing-component-or-hook-name.js";
import { getIdentifierTrailingWord } from "../../utils/get-identifier-trailing-word.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isInsideServerOnlyScope } from "../../utils/is-inside-server-only-scope.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPlaceholderSecretValue } from "../../utils/is-placeholder-secret-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A public http(s) endpoint URL (OAuth authorize URL, API base) is meant to
// ship to the browser even when its variable is named `authEndpoint`/`tokenUrl`.
// Exempt it from the NAME heuristic only — but never when the URL itself
// carries a credential (userinfo, or a `token=`/`secret=`/… query or
// #fragment param, e.g. the OAuth implicit-flow `#access_token=`), so a
// secret-bearing URL still flags. The secret-shaped-VALUE detector
// (`SECRET_PATTERNS`) runs earlier and is untouched.
const CREDENTIALED_URL_PATTERN =
  /\/\/[^/@\s]+:[^/@\s]+@|[?&#](?:access_?token|api_?key|client_?secret|token|secret|password|passwd|auth)=/i;
const isPublicUrlValue = (value: string): boolean =>
  /^https?:\/\//.test(value) && !CREDENTIALED_URL_PATTERN.test(value);

// `SECRET_COMBOBOX_MODE_DO_NOT_USE = "SECRET_COMBOBOX_MODE_DO_NOT_USE"` and
// redux action types like `"cboard/ResetPassword/STORE_PASSWORD_API_SUCCESS"`
// embed the variable's own name — a sentinel, never a credential.
const isSelfReferentialSentinelValue = (variableName: string, literalValue: string): boolean =>
  literalValue.toLowerCase().includes(variableName.toLowerCase());

// Storage/config KEY NAMES (`"auth_local_email_blocklist"`,
// `"od:memory:pending-connector-auth"`, `"__webstudio__$__api_token"`) are
// human-readable lowercase words joined by separators; real leaked secrets
// are high-entropy strings mixing case and digits.
const isIdentifierLikeKeyNameValue = (literalValue: string): boolean => {
  const wordSegments = literalValue
    .replace(/^[_$\s]+|[_$\s]+$/g, "")
    .split(/[_\-:./$]+/)
    .filter((segment) => segment.length > 0);
  if (wordSegments.length < 2) return false;
  return wordSegments.every((segment) => /^[a-z]+$/.test(segment));
};

// Frameworks with a documented public-env convention get advice naming
// their exact prefix; everything else falls back to the generic
// `recommendation`. A project carries exactly one framework token, so the
// first hit is the only hit.
const FRAMEWORK_ENV_ADVICE = [
  ["nextjs", "Next.js", "NEXT_PUBLIC_*"],
  ["vite", "Vite", "VITE_*"],
  ["tanstack-start", "TanStack Start", "VITE_*"],
  ["cra", "Create React App", "REACT_APP_*"],
  ["gatsby", "Gatsby", "GATSBY_*"],
] as const;
export const noSecretsInClientCode = defineRule({
  id: "no-secrets-in-client-code",
  title: "Secret in client code",
  severity: "warn",
  recommendation:
    "Move secrets to server-only code. Anything in client env variables gets shipped to the browser, so it can't hold secrets.",
  recommendationFor: (hasCapability) => {
    for (const [frameworkToken, frameworkName, publicEnvPrefix] of FRAMEWORK_ENV_ADVICE) {
      if (hasCapability(frameworkToken)) {
        return `Move secrets to server-only code. In ${frameworkName}, only \`${publicEnvPrefix}\` env vars are exposed to the browser, and they must not contain secrets`;
      }
    }
    return undefined;
  },
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
        const componentOrHookName = enclosingComponentOrHookName(node);
        const hasPlaceholderContext =
          SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(variableName) ||
          (componentOrHookName !== null &&
            SECRET_PLACEHOLDER_CONTEXT_PATTERN.test(componentOrHookName));
        const isUnambiguousPlaceholderValue = isPlaceholderSecretValue(literalValue, {
          allowContextualExamples: false,
        });
        const isPlaceholderValueForVariableHeuristic = isPlaceholderSecretValue(literalValue, {
          allowContextualExamples: hasPlaceholderContext,
        });

        // Public, client-safe keys ship in the browser by design; skip
        // them before either detector can flag them.
        if (PUBLIC_CLIENT_KEY_PATTERNS.some((pattern) => pattern.test(literalValue))) {
          return;
        }

        if (SECRET_PATTERNS.some((pattern) => pattern.test(literalValue))) {
          if (!isUnambiguousPlaceholderValue) {
            context.report({
              node,
              message:
                "This hardcoded secret is a security vulnerability: it ships to the browser where anyone can read it.",
            });
          }
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
          !isPublicUrlValue(literalValue) &&
          !isPlaceholderValueForVariableHeuristic &&
          !isSelfReferentialSentinelValue(variableName, literalValue) &&
          !isIdentifierLikeKeyNameValue(literalValue) &&
          !isSelfReferentialSentinelValue(variableName, literalValue) &&
          !isIdentifierLikeKeyNameValue(literalValue) &&
          literalValue.length > SECRET_MIN_LENGTH_CHARS
        ) {
          context.report({
            node,
            message: `Hardcoding "${variableName}" in client code is a security vulnerability: the secret ships to the browser where anyone can read it.`,
          });
          return;
        }
      },
    };
  },
});
