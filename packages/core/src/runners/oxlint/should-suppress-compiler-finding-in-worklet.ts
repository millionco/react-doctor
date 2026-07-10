import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { ProjectInfo } from "../../types/index.js";

// React Compiler diagnostics fire on `sharedValue.value` reads/writes even
// inside Reanimated worklets. A worklet body is extracted by Reanimated's
// babel plugin and runs on the UI thread — the React Compiler never
// memoizes it — so "this component misses automatic memoization" is false
// and no rewrite exists (`.set()` is the same write). Findings whose
// flagged span sits inside a worklet are dropped here; `.value` access in
// plain render code keeps firing (with the `.get()`/`.set()` hint from
// append-reanimated-shared-value-hint). Deliberately NOT suppressed:
// `set-state-in-render` — calling a React state setter from a worklet is
// a genuine bug (it needs `runOnJS`), so that finding stays even though
// the compiler's "in render" framing is off.
const SUPPRESSED_COMPILER_CODES = new Set(["react-hooks-js(immutability)", "react-hooks-js(refs)"]);
const WORKLET_DIRECTIVE = "worklet";

// Reanimated APIs whose function argument is implicitly a worklet (no
// explicit 'worklet' directive required).
const WORKLET_ACCEPTING_CALLEES = new Set([
  "useAnimatedStyle",
  "useAnimatedProps",
  "useDerivedValue",
  "useAnimatedReaction",
  "useAnimatedScrollHandler",
  "useAnimatedGestureHandler",
  "useFrameCallback",
  "runOnUI",
  "executeOnUIRuntimeSync",
]);

// react-native-gesture-handler v2 callbacks (`Gesture.Pan().onUpdate(...)`)
// are also auto-workletized; recognized by the chain rooting at `Gesture`.
const GESTURE_ROOT_IDENTIFIER = "Gesture";

interface OxlintSpan {
  offset: number;
}

interface OxlintLabel {
  span: OxlintSpan;
}

interface OxlintDiagnosticCandidate {
  code: string;
  filename: string;
  labels: OxlintLabel[];
}

const getScriptKind = (filename: string): ts.ScriptKind => {
  if (filename.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (filename.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (filename.endsWith(".ts")) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

const getUtf16Offset = (sourceText: string, utf8Offset: number): number =>
  Buffer.from(sourceText).subarray(0, utf8Offset).toString("utf8").length;

const hasWorkletDirective = (node: ts.SignatureDeclaration): boolean => {
  if (
    !ts.isFunctionDeclaration(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isArrowFunction(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return false;
  }
  const body = node.body;
  if (!body || !ts.isBlock(body)) return false;
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement)) return false;
    if (!ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === WORKLET_DIRECTIVE) return true;
  }
  return false;
};

const rootIdentifierOfCallChain = (expression: ts.Expression): string | null => {
  let currentExpression = expression;
  while (true) {
    if (ts.isIdentifier(currentExpression)) return currentExpression.text;
    if (ts.isPropertyAccessExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continue;
    }
    if (ts.isCallExpression(currentExpression)) {
      currentExpression = currentExpression.expression;
      continue;
    }
    return null;
  }
};

const isWorkletAcceptingCall = (callExpression: ts.CallExpression): boolean => {
  const callee = callExpression.expression;
  if (ts.isIdentifier(callee)) return WORKLET_ACCEPTING_CALLEES.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    if (WORKLET_ACCEPTING_CALLEES.has(callee.name.text)) return true;
    return rootIdentifierOfCallChain(callee) === GESTURE_ROOT_IDENTIFIER;
  }
  return false;
};

const isFunctionWorklet = (functionNode: ts.SignatureDeclaration): boolean => {
  if (hasWorkletDirective(functionNode)) return true;
  const parent = functionNode.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === functionNode) &&
    isWorkletAcceptingCall(parent)
  );
};

const findNodeAtOffset = (sourceFile: ts.SourceFile, targetOffset: number): ts.Node | null => {
  let matchedNode: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) > targetOffset || node.getEnd() <= targetOffset) return;
    matchedNode = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matchedNode;
};

const isOffsetInsideWorklet = (sourceFile: ts.SourceFile, targetOffset: number): boolean => {
  let currentNode = findNodeAtOffset(sourceFile, targetOffset);
  while (currentNode) {
    if (ts.isFunctionLike(currentNode) && isFunctionWorklet(currentNode)) return true;
    currentNode = currentNode.parent;
  }
  return false;
};

export const shouldSuppressCompilerFindingInWorklet = (
  diagnostic: OxlintDiagnosticCandidate,
  project: ProjectInfo,
  rootDirectory: string,
): boolean => {
  if (!SUPPRESSED_COMPILER_CODES.has(diagnostic.code)) return false;
  if (!project.hasReanimated) return false;
  const primaryLabel = diagnostic.labels[0];
  if (!primaryLabel) return false;

  const absolutePath = path.isAbsolute(diagnostic.filename)
    ? diagnostic.filename
    : path.join(rootDirectory, diagnostic.filename);

  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(absolutePath),
  );
  return isOffsetInsideWorklet(sourceFile, getUtf16Offset(sourceText, primaryLabel.span.offset));
};
