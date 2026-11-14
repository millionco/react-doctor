// A file scan is a PROJECT-LEVEL security check, not an oxlint AST rule:
// @react-doctor/core's check-security-scan environment check walks the
// whole project tree, reads each candidate file once, and hands it to every
// registered scan rule's `scan`. Scan rules carry registry metadata
// (id / title / severity / recommendation / tags) like any other rule but
// are excluded from the generated oxlint config and never receive visitors.

export interface ScannedFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly content: string;
  readonly isGeneratedBundle: boolean;
}

// `severity` / `title` / `help` are per-finding OVERRIDES of the rule's
// registry metadata (e.g. `public-debug-artifact` escalates to "error"
// when the artifact contains a secret value); omit them to inherit the
// rule's `severity` / `title` / `recommendation`. `severity` uses the
// plugin vocabulary ("warn") — the core dispatcher maps it to the
// diagnostic vocabulary ("warning").
export interface ScanFinding {
  readonly message: string;
  readonly line: number;
  readonly column: number;
  // Mixed source/artifact rules can restore Git-ignore filtering per finding.
  readonly committedFilesOnly?: boolean;
  readonly severity?: "error" | "warn";
  readonly title?: string;
  readonly help?: string;
}

export interface FileScan {
  (file: ScannedFile): ScanFinding[];
}
