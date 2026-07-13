import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import type { EsTreeNode } from "../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import { isFunctionLike } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-function-like.js";
import { isHookCall } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-hook-call.js";
import { isNodeOfType } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-node-of-type.js";
import { stripParenExpression } from "../../oxlint-plugin-react-doctor/src/plugin/utils/strip-paren-expression.js";
import { walkAst } from "../../oxlint-plugin-react-doctor/src/plugin/utils/walk-ast.js";
import type { EquivalentVariant } from "./equivalent-fuzz-variants.js";

interface SpannedNode {
  start?: number;
  end?: number;
  type?: string;
}

interface SpanReplacement {
  start: number;
  end: number;
  text: string;
}

const hasSpan = (node: EsTreeNode | null | undefined): node is EsTreeNode & Required<SpannedNode> =>
  Boolean(node) &&
  typeof (node as unknown as SpannedNode).start === "number" &&
  typeof (node as unknown as SpannedNode).end === "number";

const EFFECT_HOOK_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);
const EFFECT_CALLBACK_ALIAS_PREFIX = "__reactDoctorFuzzEffectCallback";

const buildEffectCallbackAliasVariant = (
  code: string,
  program: EsTreeNode,
): EquivalentVariant | null => {
  if (code.includes(EFFECT_CALLBACK_ALIAS_PREFIX)) return null;
  const replacements: SpanReplacement[] = [];
  let callbackIndex = 0;
  walkAst(program, (statement) => {
    if (!isNodeOfType(statement, "ExpressionStatement") || !hasSpan(statement)) return;
    const node = statement.expression;
    if (!isNodeOfType(node, "CallExpression") || !isHookCall(node, EFFECT_HOOK_NAMES)) return;
    const callback = node.arguments[0];
    if (!callback || isNodeOfType(callback, "SpreadElement") || !hasSpan(callback)) return;
    if (!isFunctionLike(stripParenExpression(callback))) return;
    const lineStart = code.lastIndexOf("\n", statement.start - 1) + 1;
    const indentation = code.slice(lineStart, statement.start);
    if (!/^[\t ]*$/.test(indentation)) return;
    const callbackName = `${EFFECT_CALLBACK_ALIAS_PREFIX}${callbackIndex}`;
    callbackIndex += 1;
    replacements.push(
      {
        start: lineStart,
        end: lineStart,
        text: `${indentation}const ${callbackName} = ${code.slice(callback.start, callback.end)};\n`,
      },
      { start: callback.start, end: callback.end, text: callbackName },
    );
  });
  if (replacements.length === 0) return null;
  replacements.sort((left, right) => right.start - left.start);
  let variantCode = code;
  for (const replacement of replacements) {
    variantCode =
      variantCode.slice(0, replacement.start) +
      replacement.text +
      variantCode.slice(replacement.end);
  }
  return {
    label: "inline effect callbacks extracted to const bindings",
    code: variantCode,
  };
};

const parseProgram = (code: string, filename: string): EsTreeNode | null => {
  try {
    const { program, errors } = parseFixture(code, { filename, forceJsx: true });
    return errors.length > 0 ? null : program;
  } catch {
    return null;
  }
};

const getTopLevelStatementSpans = (program: EsTreeNode): Array<{ start: number; end: number }> => {
  const body = (program as unknown as { body?: SpannedNode[] }).body ?? [];
  const spans: Array<{ start: number; end: number }> = [];
  for (const statement of body) {
    if (typeof statement.start !== "number" || typeof statement.end !== "number") return [];
    spans.push({ start: statement.start, end: statement.end });
  }
  return spans;
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
  shouldExtractEffectCallbacks = false,
): EquivalentVariant[] => {
  const variants: EquivalentVariant[] = [];
  const program = parseProgram(code, filename);
  if (!program) return variants;
  if (isCrlfSafe(code) && code.includes("\n")) {
    variants.push({
      label: "CRLF line endings",
      code: code.replace(/\r?\n/g, "\r\n"),
    });
  }
  const spans = getTopLevelStatementSpans(program);
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
  if (shouldExtractEffectCallbacks) {
    const effectCallbackAliasVariant = buildEffectCallbackAliasVariant(code, program);
    if (effectCallbackAliasVariant) variants.push(effectCallbackAliasVariant);
  }
  return variants;
};
