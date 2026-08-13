import ts from "typescript";
import { unwrapTypescriptExpression } from "../../utils/unwrap-typescript-expression.js";
import { getObjectLiteralElementName } from "./get-object-literal-element-name.js";
import { extractPackageName } from "./package-name.js";

export const collectConfigPluginMapPackageNames = (expression: ts.Expression): Set<string> => {
  const packageNames = new Set<string>();
  const collectExpression = (currentExpression: ts.Expression): void => {
    const unwrappedExpression = unwrapTypescriptExpression(currentExpression);
    if (ts.isConditionalExpression(unwrappedExpression)) {
      collectExpression(unwrappedExpression.whenTrue);
      collectExpression(unwrappedExpression.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(unwrappedExpression) &&
      [
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(unwrappedExpression.operatorToken.kind)
    ) {
      collectExpression(unwrappedExpression.left);
      collectExpression(unwrappedExpression.right);
      return;
    }
    if (!ts.isObjectLiteralExpression(unwrappedExpression)) return;

    for (const property of unwrappedExpression.properties) {
      if (ts.isSpreadAssignment(property)) {
        collectExpression(property.expression);
        continue;
      }
      const propertyName = getObjectLiteralElementName(property);
      if (!propertyName) continue;
      const packageName = extractPackageName(propertyName);
      if (packageName) packageNames.add(packageName);
    }
  };

  collectExpression(expression);
  return packageNames;
};
