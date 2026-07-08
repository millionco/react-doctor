import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import type { EquivalentVariant } from "./equivalent-fuzz-variants.js";

interface SpannedNode {
  start?: number;
  end?: number;
  type?: string;
}

const getTopLevelStatementSpans = (
  code: string,
  filename: string,
): Array<{ start: number; end: number }> => {
  try {
    const { program, errors } = parseFixture(code, { filename, forceJsx: true });
    if (errors.length > 0) return [];
    const body = (program as unknown as { body?: SpannedNode[] }).body ?? [];
    const spans: Array<{ start: number; end: number }> = [];
    for (const statement of body) {
      if (typeof statement.start !== "number" || typeof statement.end !== "number") return [];
      spans.push({ start: statement.start, end: statement.end });
    }
    return spans;
  } catch {
    return [];
  }
};

const spliceBetweenStatements = (
  code: string,
  spans: ReadonlyArray<{ start: number; end: number }>,
  separator: string,
): string => {
  let result = "";
  let cursor = 0;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    result += code.slice(cursor, span.end);
    cursor = span.end;
    if (index < spans.length - 1) result += separator;
  }
  result += code.slice(cursor);
  return result;
};

// CRLF conversion changes the VALUE of multi-line template literals and
// line-continuation strings, so those programs are excluded rather than
// producing a semantics-changing "equivalent".
const isCrlfSafe = (code: string): boolean => !code.includes("`") && !code.includes("\\\n");

// AST-derived semantics-preserving rewrites for ANY parseable program
// (including verbatim corpus files, which have no generator-provided
// section list): splices land exactly between top-level statements, so
// they can never fall inside a template literal or JSX text.
export const buildAstEquivalentFuzzVariants = (
  code: string,
  filename: string,
): EquivalentVariant[] => {
  const variants: EquivalentVariant[] = [];
  if (isCrlfSafe(code) && code.includes("\n")) {
    variants.push({
      label: "CRLF line endings",
      code: code.replace(/\r?\n/g, "\r\n"),
    });
  }
  const spans = getTopLevelStatementSpans(code, filename);
  if (spans.length > 1) {
    const doAllGapsContainNewline = spans.every(
      (span, index) =>
        index === spans.length - 1 || code.slice(span.end, spans[index + 1].start).includes("\n"),
    );
    if (doAllGapsContainNewline) {
      variants.push({
        label: "line comments between top-level statements",
        code: spliceBetweenStatements(code, spans, "\n// metamorphic statement separator"),
      });
    }
    variants.push(
      {
        label: "block comments between top-level statements",
        code: spliceBetweenStatements(code, spans, "\n/* metamorphic\n   statement separator */"),
      },
      {
        label: "blank lines between top-level statements",
        code: spliceBetweenStatements(code, spans, "\n\n\n"),
      },
    );
  }
  return variants;
};
