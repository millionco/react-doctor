import ts from "typescript";
import { getCallName } from "./get-call-name.js";

export const getFunctionName = (functionNode: ts.FunctionLikeDeclaration): string | null => {
  if (functionNode.name && ts.isIdentifier(functionNode.name)) return functionNode.name.text;
  if (
    ts.isMethodDeclaration(functionNode) &&
    (ts.isIdentifier(functionNode.name) || ts.isStringLiteral(functionNode.name))
  ) {
    return functionNode.name.text;
  }
  if (ts.isVariableDeclaration(functionNode.parent) && ts.isIdentifier(functionNode.parent.name)) {
    return functionNode.parent.name.text;
  }
  if (
    ts.isPropertyAssignment(functionNode.parent) &&
    (ts.isIdentifier(functionNode.parent.name) || ts.isStringLiteral(functionNode.parent.name))
  ) {
    return functionNode.parent.name.text;
  }
  if (ts.isCallExpression(functionNode.parent)) {
    const wrapperName = getCallName(functionNode.parent)?.split(".").at(-1);
    const wrapperOwner = functionNode.parent.parent;
    if (
      (wrapperName === "memo" || wrapperName === "forwardRef") &&
      ts.isVariableDeclaration(wrapperOwner) &&
      ts.isIdentifier(wrapperOwner.name)
    ) {
      return wrapperOwner.name.text;
    }
  }
  if (ts.isExportAssignment(functionNode.parent) && !functionNode.parent.isExportEquals) {
    return "DefaultComponent";
  }
  return null;
};
