// rule: artifact-env-leak
// weakness: name-heuristic
// source: PR #1320 cross-review
const _FuzzProcessName = "process";
const _FuzzDatabaseKeyName = "DATABASE_URL";
export const FuzzDocumentationUrl = "https://example.com";
