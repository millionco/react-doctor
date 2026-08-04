import ts from "typescript";
import { unwrapTypescriptExpression } from "../unwrap-typescript-expression.js";
import { getStaticAccessMemberName } from "./get-static-access-member-name.js";

export const isThisStateExpression = (expression: ts.Expression): boolean => {
  let currentExpression = unwrapTypescriptExpression(expression);
  const members: string[] = [];
  while (
    ts.isPropertyAccessExpression(currentExpression) ||
    ts.isElementAccessExpression(currentExpression)
  ) {
    const memberName = getStaticAccessMemberName(currentExpression);
    if (!memberName) return false;
    members.unshift(memberName);
    currentExpression = unwrapTypescriptExpression(currentExpression.expression);
  }
  return currentExpression.kind === ts.SyntaxKind.ThisKeyword && members[0] === "state";
};
