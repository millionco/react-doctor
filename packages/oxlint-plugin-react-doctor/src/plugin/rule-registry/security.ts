// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noEval } from "./../rules/security/no-eval.js";
import { noSecretsInClientCode } from "./../rules/security/no-secrets-in-client-code.js";

export const SecurityRuleEntries = [
  {
    key: "react-doctor/no-eval",
    id: "no-eval",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Security",
    severity: "error",
    rule: {
      ...noEval,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/no-secrets-in-client-code",
    id: "no-secrets-in-client-code",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...noSecretsInClientCode,
      framework: "global",
      category: "Security",
    },
  },
] as const;
