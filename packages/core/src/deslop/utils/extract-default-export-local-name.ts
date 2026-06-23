import type { ExportDefaultDeclaration } from "@oxc-project/types";
import type { Expression } from "@oxc-project/types";

const extractIdentifierFromCallArguments = (expression: Expression): string | undefined => {
  if (expression.type !== "CallExpression") return undefined;

  for (const argument of expression.arguments) {
    if (argument.type === "Identifier" && argument.name) {
      return argument.name;
    }
    if (argument.type === "CallExpression") {
      const nestedName = extractIdentifierFromCallArguments(argument);
      if (nestedName) return nestedName;
    }
  }

  if (expression.callee.type === "CallExpression") {
    return extractIdentifierFromCallArguments(expression.callee);
  }

  return undefined;
};

export const extractDefaultExportLocalName = (
  declaration: ExportDefaultDeclaration["declaration"],
): string | undefined => {
  if (!declaration) return undefined;

  if (declaration.type === "Identifier" && declaration.name) {
    return declaration.name;
  }

  if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
    return declaration.id?.name;
  }

  if (declaration.type === "CallExpression") {
    return extractIdentifierFromCallArguments(declaration);
  }

  return undefined;
};
