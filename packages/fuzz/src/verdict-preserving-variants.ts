import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { attachParentReferences } from "../../oxlint-plugin-react-doctor/src/test-utils/attach-parent-references.js";
import { walkAst } from "../../oxlint-plugin-react-doctor/src/plugin/utils/walk-ast.js";
import { isNodeOfType } from "../../oxlint-plugin-react-doctor/src/plugin/utils/is-node-of-type.js";
import { findTransparentExpressionRoot } from "../../oxlint-plugin-react-doctor/src/plugin/utils/find-transparent-expression-root.js";
import type { EsTreeNode } from "../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import { MAX_VERDICT_VARIANT_ANCHORS } from "./constants.js";

// The mutation-robustness catalog: rewrites that change the SOURCE SHAPE of
// a program while preserving the verdict a rule should reach ("x + 1 = 2"
// vs "x + 1 + 1 - 1 = 2"). A rule that fires on a trigger seed but goes
// silent on one of these variants is keying on incidental token shape —
// the false-negative brittleness class the react-bench audit surfaced over
// and over (paren-shape, wrapper-transparency, control-flow hops).
//
// Two tiers:
// - mustPreserveVerdict: semantics-identical for any React-semantics rule
//   (extra parens, TS cast wrappers a rule must strip, concise-arrow →
//   block-arrow, no-op prologue statements). Losing the diagnostic here is
//   a hard robustness gap.
// - advisory (mustPreserveVerdict: false): known evasion shapes rules often
//   deliberately don't chase (optional chaining flips the callee node type
//   to ChainExpression). Losing the diagnostic is a coverage-gap signal to
//   triage, not an automatic bug.
export interface VerdictPreservingVariant {
  readonly label: string;
  readonly code: string;
  readonly mustPreserveVerdict: boolean;
}

interface SpanEdit {
  readonly position: number;
  readonly insertText: string;
}

interface SpannedNode {
  readonly start: number;
  readonly end: number;
}

interface CallReceiverSpan extends SpannedNode {
  readonly needsLeadingSemicolon: boolean;
}

const hasSpan = (node: EsTreeNode | null | undefined): node is EsTreeNode & SpannedNode =>
  Boolean(node) &&
  typeof (node as unknown as SpannedNode).start === "number" &&
  typeof (node as unknown as SpannedNode).end === "number";

const applyEdits = (code: string, edits: ReadonlyArray<SpanEdit>): string => {
  // Descending-position insertion keeps every earlier offset valid. Ties
  // apply in reverse collection order, which nests parens symmetrically.
  const ordered = [...edits].sort((a, b) => b.position - a.position);
  let result = code;
  for (const edit of ordered) {
    result = result.slice(0, edit.position) + edit.insertText + result.slice(edit.position);
  }
  return result;
};

const parseProgram = (code: string, filename: string): EsTreeNode | null => {
  try {
    const { program, errors } = parseFixture(code, { filename, forceJsx: true });
    if (errors.length > 0) return null;
    attachParentReferences(program);
    return program;
  } catch {
    return null;
  }
};

// Anchors: `obj` in every `obj.method(...)` call — the receiver position
// rules most often match structurally. `super` cannot be parenthesized and
// JSX member callees don't exist, so only plain expression objects anchor.
const collectCallReceiverSpans = (program: EsTreeNode): CallReceiverSpan[] => {
  const spans: CallReceiverSpan[] = [];
  walkAst(program, (node: EsTreeNode) => {
    if (spans.length >= MAX_VERDICT_VARIANT_ANCHORS) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = node.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
    if (callee.optional) return;
    const receiver = callee.object;
    if (!hasSpan(receiver)) return;
    if (isNodeOfType(receiver, "Super")) return;
    const expressionRoot = findTransparentExpressionRoot(node);
    const expressionStatement = expressionRoot.parent;
    const statementParent = expressionStatement?.parent;
    const needsLeadingSemicolon =
      isNodeOfType(expressionStatement, "ExpressionStatement") &&
      (isNodeOfType(statementParent, "Program") ||
        isNodeOfType(statementParent, "BlockStatement") ||
        isNodeOfType(statementParent, "SwitchCase"));
    spans.push({ start: receiver.start, end: receiver.end, needsLeadingSemicolon });
  });
  return spans;
};

const collectConciseArrowBodySpans = (code: string, program: EsTreeNode): SpannedNode[] => {
  const spans: SpannedNode[] = [];
  walkAst(program, (node: EsTreeNode) => {
    if (spans.length >= MAX_VERDICT_VARIANT_ANCHORS) return false;
    if (!isNodeOfType(node, "ArrowFunctionExpression")) return;
    if (isNodeOfType(node.body, "BlockStatement")) return;
    if (!hasSpan(node.body)) return;
    // `() => ({...})` — with preserveParens: false the body span excludes
    // the source parens, so splicing `{ return (` inside them would break.
    // Widen the span over any wrapping parens instead.
    let start = node.body.start;
    let end = node.body.end;
    while (
      code[skipWhitespaceBackward(code, start)] === "(" &&
      code[skipWhitespaceForward(code, end)] === ")"
    ) {
      start = skipWhitespaceBackward(code, start);
      end = skipWhitespaceForward(code, end) + 1;
    }
    spans.push({ start, end });
  });
  return spans;
};

const skipWhitespaceBackward = (code: string, position: number): number => {
  let cursor = position - 1;
  while (cursor >= 0 && /\s/.test(code[cursor])) cursor -= 1;
  return cursor;
};

const skipWhitespaceForward = (code: string, position: number): number => {
  let cursor = position;
  while (cursor < code.length && /\s/.test(code[cursor])) cursor += 1;
  return cursor;
};

const collectFunctionBodyBlockSpans = (program: EsTreeNode): SpannedNode[] => {
  const spans: SpannedNode[] = [];
  walkAst(program, (node: EsTreeNode) => {
    if (spans.length >= MAX_VERDICT_VARIANT_ANCHORS) return false;
    if (
      !isNodeOfType(node, "ArrowFunctionExpression") &&
      !isNodeOfType(node, "FunctionExpression") &&
      !isNodeOfType(node, "FunctionDeclaration")
    ) {
      return;
    }
    const body = node.body;
    if (!isNodeOfType(body, "BlockStatement") || !hasSpan(body)) return;
    spans.push({ start: body.start, end: body.end });
  });
  return spans;
};

interface MemberCallShape {
  readonly dotPosition: number;
  readonly propertyStart: number;
  readonly propertyEnd: number;
  readonly propertyName: string;
}

const collectMemberCallShapes = (program: EsTreeNode, code: string): MemberCallShape[] => {
  const shapes: MemberCallShape[] = [];
  walkAst(program, (node: EsTreeNode) => {
    if (shapes.length >= MAX_VERDICT_VARIANT_ANCHORS) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = node.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed || callee.optional) return;
    if (!isNodeOfType(callee.property, "Identifier")) return;
    if (!hasSpan(callee.object) || !hasSpan(callee.property)) return;
    const dotIndex = code.indexOf(".", callee.object.end);
    if (dotIndex === -1 || dotIndex >= callee.property.start) return;
    shapes.push({
      dotPosition: dotIndex,
      propertyStart: callee.property.start,
      propertyEnd: callee.property.end,
      propertyName: callee.property.name,
    });
  });
  return shapes;
};

const buildComputedMemberVariantCode = (
  code: string,
  shapes: ReadonlyArray<MemberCallShape>,
): string => {
  // Rewrites right-to-left so earlier spans stay valid: `.prop` becomes
  // `["prop"]`, consuming the dot through the property identifier.
  const ordered = [...shapes].sort((a, b) => b.dotPosition - a.dotPosition);
  let result = code;
  for (const shape of ordered) {
    result =
      result.slice(0, shape.dotPosition) +
      `["${shape.propertyName}"]` +
      result.slice(shape.propertyEnd);
  }
  return result;
};

const buildReceiverWrapVariant = (
  code: string,
  spans: ReadonlyArray<CallReceiverSpan>,
  label: string,
  open: string,
  close: string,
  mustPreserveVerdict: boolean,
): VerdictPreservingVariant | null => {
  if (spans.length === 0) return null;
  const edits: SpanEdit[] = [];
  for (const span of spans) {
    edits.push({
      position: span.start,
      insertText: span.needsLeadingSemicolon ? `;${open}` : open,
    });
    edits.push({ position: span.end, insertText: close });
  }
  return { label, code: applyEdits(code, edits), mustPreserveVerdict };
};

// Builds the catalog for one program. Variants that fail to parse are
// discarded by the caller (each rewrite is span-precise, but combinations
// like paren-wrapping an assignment target can still produce residue).
export const buildVerdictPreservingVariants = (
  code: string,
  filename: string,
): VerdictPreservingVariant[] => {
  const program = parseProgram(code, filename);
  if (!program) return [];

  const variants: Array<VerdictPreservingVariant | null> = [];
  const receiverSpans = collectCallReceiverSpans(program);

  variants.push(
    buildReceiverWrapVariant(code, receiverSpans, "parenthesized call receivers", "(", ")", true),
    buildReceiverWrapVariant(code, receiverSpans, "as-any call receivers", "(", " as any)", true),
    buildReceiverWrapVariant(
      code,
      receiverSpans,
      "non-null-asserted call receivers",
      "(",
      "!)",
      true,
    ),
  );

  const conciseBodySpans = collectConciseArrowBodySpans(code, program);
  if (conciseBodySpans.length > 0) {
    const edits: SpanEdit[] = [];
    for (const span of conciseBodySpans) {
      edits.push({ position: span.start, insertText: "{ return (" });
      edits.push({ position: span.end, insertText: "); }" });
    }
    variants.push({
      label: "concise arrow bodies converted to block returns",
      code: applyEdits(code, edits),
      mustPreserveVerdict: true,
    });
  }

  const bodyBlockSpans = collectFunctionBodyBlockSpans(program);
  if (bodyBlockSpans.length > 0) {
    const edits: SpanEdit[] = bodyBlockSpans.map((span) => ({
      // Right after the block's `{`.
      position: span.start + 1,
      insertText: " void 0;",
    }));
    variants.push({
      label: "no-op prologue statement in every function body",
      code: applyEdits(code, edits),
      mustPreserveVerdict: true,
    });
  }

  const memberCallShapes = collectMemberCallShapes(program, code);
  if (memberCallShapes.length > 0) {
    variants.push({
      label: "optional-chained member calls",
      code: applyEdits(
        code,
        memberCallShapes.map((shape) => ({ position: shape.dotPosition, insertText: "?" })),
      ),
      // `a.b()` → `a?.b()` only diverges when `a` is nullish (throw →
      // undefined) and flips the callee to ChainExpression — a known
      // static-analysis boundary, so a drop is a coverage signal to
      // triage rather than an automatic bug.
      mustPreserveVerdict: false,
    });
    // `a.b()` → `a["b"]()` — same call, computed-member spelling. Rules
    // legitimately treat computed members as opaque (dynamic-computed
    // weakness class), so this stays advisory too.
    variants.push({
      label: "computed-member call properties",
      code: buildComputedMemberVariantCode(code, memberCallShapes),
      mustPreserveVerdict: false,
    });
  }

  return variants.filter(
    (variant): variant is VerdictPreservingVariant =>
      variant !== null && parseProgram(variant.code, filename) !== null,
  );
};
