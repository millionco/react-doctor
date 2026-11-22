import ts from "typescript";
import { getTypescriptScriptKind } from "./get-typescript-script-kind.js";

interface SourceByteSpan {
  readonly offset: number;
  readonly length: number;
}

export const isJsxRefPropertySpan = (
  filename: string,
  source: Buffer,
  span: SourceByteSpan,
): boolean => {
  const end = span.offset + span.length;
  if (
    !Number.isSafeInteger(span.offset) ||
    !Number.isSafeInteger(span.length) ||
    span.offset < 0 ||
    span.length <= 0 ||
    end > source.length ||
    !source.subarray(span.offset, end).toString("utf8").endsWith(".ref")
  ) {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    filename,
    source.toString("utf8"),
    ts.ScriptTarget.Latest,
    false,
    getTypescriptScriptKind(filename),
  );
  const startUtf16 = source.subarray(0, span.offset).toString("utf8").length;
  const endUtf16 = source.subarray(0, end).toString("utf8").length;
  const findAttribute = (node: ts.Node): true | undefined => {
    if (node.getFullStart() > startUtf16 || node.getEnd() < endUtf16) return undefined;
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "ref" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      return expression &&
        ts.isPropertyAccessExpression(expression) &&
        !expression.questionDotToken &&
        ts.isIdentifier(expression.expression) &&
        expression.name.text === "ref" &&
        expression.getStart(sourceFile) === startUtf16 &&
        expression.getEnd() === endUtf16
        ? true
        : undefined;
    }
    return ts.forEachChild(node, findAttribute);
  };
  return findAttribute(sourceFile) === true;
};
