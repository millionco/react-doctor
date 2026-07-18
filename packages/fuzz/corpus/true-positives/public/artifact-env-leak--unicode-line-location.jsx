// rule: artifact-env-leak
// weakness: other
// source: PR #1320 cross-review
export const FuzzUnicodeLine = `before after`;
export const FuzzDatabaseUrl = process.env.DATABASE_URL;
