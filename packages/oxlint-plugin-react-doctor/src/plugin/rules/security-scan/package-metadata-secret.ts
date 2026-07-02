import { JWT_LITERAL_VALUE_PATTERN, SECRET_VALUE_PATTERNS } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSuspiciousPublicEnvSecretNamePattern } from "./utils/find-suspicious-public-env-secret-name.js";
import { getMatchLocation } from "./utils/get-match-location.js";

// The bare keyword `service_role` (a Supabase role *name*) is a legitimate
// word in a helper package's `description`/`keywords` — not a leaked secret.
// A genuine service_role *credential* is a JWT (`eyJ…`) or `sb_secret_…`;
// `sb_secret_` is caught by SECRET_VALUE_PATTERNS, and the JWT value is
// caught by JWT_LITERAL_VALUE_PATTERN below (scoped to package metadata —
// unlike source files, where anon-key JWTs are legitimate, ANY JWT literal
// committed into package.json is a leak).
const PACKAGE_METADATA_VALUE_PATTERNS = [
  ...SECRET_VALUE_PATTERNS.filter((pattern) => !pattern.test("service_role")),
  JWT_LITERAL_VALUE_PATTERN,
];

export const packageMetadataSecret = defineRule({
  id: "package-metadata-secret",
  title: "Secret-like package metadata",
  severity: "warn",
  recommendation:
    "Keep secrets out of package metadata and generated reports; they are often published to registries, logs, or browser artifacts.",
  scan: (file) => {
    if (!file.relativePath.endsWith("package.json")) return [];
    const pattern =
      findSuspiciousPublicEnvSecretNamePattern(file.content) ??
      PACKAGE_METADATA_VALUE_PATTERNS.find((candidate) => candidate.test(file.content));
    if (pattern === undefined) return [];

    const location = getMatchLocation(file.content, pattern);
    return [
      {
        message: "Package metadata contains secret-like values or public env secret names.",
        line: location.line,
        column: location.column,
      },
    ];
  },
});
