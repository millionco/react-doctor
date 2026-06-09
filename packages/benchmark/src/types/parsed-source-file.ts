import type { ScanFinding } from "./scan-finding.js";

// A comment as reported by oxc-parser (byte-offset spans, no line info).
export interface SourceComment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
}

// One changed source file, parsed once and shared by every AST check. `program`
// is the oxc ESTree `Program` node; it is intentionally untyped (`unknown`)
// because the checks walk it structurally by `type` rather than against a
// committed AST type surface.
export interface ParsedSourceFile {
  // Repo-relative path, matching React Doctor's `filePath` convention.
  filePath: string;
  sourceText: string;
  program: unknown;
  comments: SourceComment[];
}

// A structurally-typed AST node: anything with a string `type`, plus arbitrary
// child fields the checks read by name. The oxc AST is walked this way rather
// than against a committed, versioned AST type surface.
export interface AstVisitorNode {
  type: string;
  [key: string]: unknown;
}

// An AST check: a pure function from one parsed file to its findings. Lives in
// `src/checks/<kebab-name>.ts`, one check per file, and is registered in
// `checks/index.ts`.
export type AstCheck = (file: ParsedSourceFile) => ScanFinding[];
