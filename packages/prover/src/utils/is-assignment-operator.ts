import ts from "typescript";

export const isAssignmentOperator = (operator: ts.SyntaxKind): boolean =>
  operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
