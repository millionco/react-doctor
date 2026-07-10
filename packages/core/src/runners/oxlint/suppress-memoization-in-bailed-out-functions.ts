import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { Diagnostic } from "../../types/index.js";

const MANUAL_MEMOIZATION_PLUGIN = "react-doctor";
const MANUAL_MEMOIZATION_RULE = "react-compiler-no-manual-memoization";
const REACT_COMPILER_PLUGIN = "react-hooks-js";

interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

const getScriptKind = (filename: string): ts.ScriptKind => {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filename.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filename.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

const isManualMemoizationDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.plugin === MANUAL_MEMOIZATION_PLUGIN && diagnostic.rule === MANUAL_MEMOIZATION_RULE;

const nodeLineRange = (sourceFile: ts.SourceFile, node: ts.Node): LineRange => ({
  startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  endLine: sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
});

// The OUTERMOST function-like node whose line range contains `targetLine`
// — the component/hook boundary React Compiler compiles (or bails out of)
// as a unit. A function whose range misses the line can't contain it in
// any descendant either, so the walk prunes there.
const findOutermostEnclosingFunctionRange = (
  sourceFile: ts.SourceFile,
  targetLine: number,
): LineRange | null => {
  let foundRange: LineRange | null = null;
  const visit = (node: ts.Node): void => {
    if (foundRange) return;
    if (ts.isFunctionLike(node)) {
      const range = nodeLineRange(sourceFile, node);
      if (range.startLine <= targetLine && targetLine <= range.endLine) {
        foundRange = range;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return foundRange;
};

const NEWLINE_BYTE = 10;

const lineOfUtf8Offset = (sourceBuffer: Buffer, utf8Offset: number): number => {
  let lineNumber = 1;
  const scanEnd = Math.min(utf8Offset, sourceBuffer.length);
  for (let byteIndex = 0; byteIndex < scanEnd; byteIndex++) {
    if (sourceBuffer[byteIndex] === NEWLINE_BYTE) lineNumber++;
  }
  return lineNumber;
};

/**
 * Drops `react-doctor/react-compiler-no-manual-memoization` diagnostics
 * whose enclosing function also carries a `react-hooks-js` (React
 * Compiler) diagnostic. Every react-hooks-js finding marks a function the
 * compiler could NOT compile (a bail-out / skip / preserve-manual-
 * memoization failure), so "React Compiler already caches every value
 * here" is false for that function and the manual memoization is
 * load-bearing, not dead weight.
 *
 * Matching is per enclosing function, not per file: a bailed-out
 * component must not silence redundant-memo findings in a sibling
 * component the compiler did optimize.
 *
 * Module-scope `memo(() => …)` wrappers have no enclosing function; for
 * those the memo call's own span is the containment range, so a bail-out
 * inside the inline-wrapped component still suppresses. Every failure
 * path (unreadable file, missing span) fails open and keeps the
 * diagnostic.
 */
export const suppressMemoizationInBailedOutFunctions = (
  diagnostics: Diagnostic[],
  rootDirectory: string,
): Diagnostic[] => {
  const compilerDiagnosticLinesByFile = new Map<string, number[]>();
  let hasManualMemoizationDiagnostic = false;
  for (const diagnostic of diagnostics) {
    if (isManualMemoizationDiagnostic(diagnostic)) {
      hasManualMemoizationDiagnostic = true;
      continue;
    }
    if (diagnostic.plugin !== REACT_COMPILER_PLUGIN || diagnostic.line <= 0) continue;
    const lines = compilerDiagnosticLinesByFile.get(diagnostic.filePath);
    if (lines) lines.push(diagnostic.line);
    else compilerDiagnosticLinesByFile.set(diagnostic.filePath, [diagnostic.line]);
  }
  if (!hasManualMemoizationDiagnostic || compilerDiagnosticLinesByFile.size === 0) {
    return diagnostics;
  }

  const parsedFileCache = new Map<string, { sourceFile: ts.SourceFile; buffer: Buffer } | null>();
  const readAndParse = (filePath: string): { sourceFile: ts.SourceFile; buffer: Buffer } | null => {
    const cached = parsedFileCache.get(filePath);
    if (cached !== undefined) return cached;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(rootDirectory || ".", filePath);
    let parsed: { sourceFile: ts.SourceFile; buffer: Buffer } | null;
    try {
      const buffer = fs.readFileSync(absolutePath);
      parsed = {
        sourceFile: ts.createSourceFile(
          absolutePath,
          buffer.toString("utf8"),
          ts.ScriptTarget.Latest,
          true,
          getScriptKind(absolutePath),
        ),
        buffer,
      };
    } catch {
      parsed = null;
    }
    parsedFileCache.set(filePath, parsed);
    return parsed;
  };

  const isInsideBailedOutFunction = (diagnostic: Diagnostic): boolean => {
    const compilerLines = compilerDiagnosticLinesByFile.get(diagnostic.filePath);
    if (!compilerLines || diagnostic.line <= 0) return false;
    const parsed = readAndParse(diagnostic.filePath);
    if (!parsed) return false;
    let containmentRange = findOutermostEnclosingFunctionRange(parsed.sourceFile, diagnostic.line);
    if (!containmentRange && diagnostic.offset !== undefined && diagnostic.length !== undefined) {
      containmentRange = {
        startLine: diagnostic.line,
        endLine: lineOfUtf8Offset(parsed.buffer, diagnostic.offset + diagnostic.length),
      };
    }
    if (!containmentRange) return false;
    const { startLine, endLine } = containmentRange;
    return compilerLines.some(
      (compilerLine) => startLine <= compilerLine && compilerLine <= endLine,
    );
  };

  return diagnostics.filter(
    (diagnostic) =>
      !isManualMemoizationDiagnostic(diagnostic) || !isInsideBailedOutFunction(diagnostic),
  );
};
