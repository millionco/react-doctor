import { defineRule } from "../../utils/define-rule.js";
import { findSuspiciousPublicEnvSecretNamePattern } from "./utils/find-suspicious-public-env-secret-name.js";
import { getMatchLocation } from "./utils/get-match-location.js";
import { isClientSourcePath } from "./utils/is-client-source-path.js";

// Source files under a docs tree are onboarding snippets, not shipped code.
const DOCS_DIRECTORY_PATTERN = /(?:^|\/)docs?\//i;

export const publicEnvSecretName = defineRule({
  id: "public-env-secret-name",
  title: "Secret-like public env variable",
  severity: "warn",
  recommendation:
    "Public env prefixes are inlined into browser bundles. Rename public values to non-secret names, and keep tokens, passwords, private keys, and service-role credentials server-only.",
  scan: (file) => {
    if (!isClientSourcePath(file.relativePath)) return [];
    if (DOCS_DIRECTORY_PATTERN.test(file.relativePath)) return [];
    const pattern = findSuspiciousPublicEnvSecretNamePattern(file.content);
    if (pattern === undefined) return [];

    const location = getMatchLocation(file.content, pattern);
    return [
      {
        message:
          "Client code references a public env variable whose name looks like a secret or privileged credential.",
        line: location.line,
        column: location.column,
      },
    ];
  },
});
