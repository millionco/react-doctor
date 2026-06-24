// Trailing whitespace and a final newline don't change a workflow's meaning, so
// the round-trip safety check (does the file still match what React Doctor
// generates?) ignores them. Shared by both CI providers so the overwrite-safety
// contract can't drift between GitHub Actions and GitLab CI.
export const normalizeWorkflowContent = (content: string): string =>
  content
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "");
