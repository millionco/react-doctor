import { TEST_CONTEXT_PATTERN } from "../../constants/security-scan.js";
import { SECRET_VALUE_PATTERNS } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { findSuspiciousPublicEnvSecretNamePattern } from "./utils/find-suspicious-public-env-secret-name.js";
import { getMatchLocation } from "./utils/get-match-location.js";
import { isRepositorySecretFilePath } from "./utils/is-repository-secret-file-path.js";

const isRepositorySecretExamplePath = (relativePath: string): boolean =>
  /(?:^|\/)\.env\.(?:example|sample|template|dist|defaults?)$|(?:^|\/)[^/]*(?:example|sample|template)[^/]*\.(?:env|json|pem|key)$/i.test(
    relativePath,
  );

export const repositorySecretFile = defineRule({
  id: "repository-secret-file",
  title: "Secret file checked into repository",
  severity: "error",
  committedFilesOnly: true,
  recommendation:
    "Remove committed env files, service-account credentials, npm auth tokens, and webhook URLs; rotate exposed values and keep only redacted examples in source.",
  scan: (file) => {
    if (!isRepositorySecretFilePath(file.relativePath)) return [];
    if (isRepositorySecretExamplePath(file.relativePath)) return [];
    if (TEST_CONTEXT_PATTERN.test(file.relativePath)) return [];

    const pattern =
      SECRET_VALUE_PATTERNS.find((candidate) => candidate.test(file.content)) ??
      findSuspiciousPublicEnvSecretNamePattern(file.content);
    if (pattern === undefined) return [];

    const location = getMatchLocation(file.content, pattern);
    return [
      {
        message: "A repository credential/config file contains secret-looking values.",
        line: location.line,
        column: location.column,
      },
    ];
  },
});
