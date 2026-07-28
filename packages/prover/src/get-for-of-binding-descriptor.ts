import ts from "typescript";

export interface ForOfBindingDescriptor {
  forOfStatement: ts.ForOfStatement;
  isComplete: boolean;
  propertyPath: ReadonlyArray<string>;
  variableDeclaration: ts.VariableDeclaration;
}

const isBindingPatternComplete = (bindingPattern: ts.BindingPattern): boolean =>
  bindingPattern.elements.every((bindingElement) => {
    if (ts.isOmittedExpression(bindingElement)) return true;
    if (bindingElement.dotDotDotToken || bindingElement.initializer) return false;
    if (
      ts.isObjectBindingPattern(bindingPattern) &&
      bindingElement.propertyName &&
      !ts.isIdentifier(bindingElement.propertyName) &&
      !ts.isStringLiteral(bindingElement.propertyName) &&
      !ts.isNumericLiteral(bindingElement.propertyName)
    ) {
      return false;
    }
    return true;
  });

const getObjectBindingPropertyName = (bindingElement: ts.BindingElement): string | null => {
  const propertyName = bindingElement.propertyName ?? bindingElement.name;
  return ts.isIdentifier(propertyName) ||
    ts.isStringLiteral(propertyName) ||
    ts.isNumericLiteral(propertyName)
    ? propertyName.text
    : null;
};

const createForOfBindingDescriptor = (
  variableDeclaration: ts.VariableDeclaration,
  propertyPath: ReadonlyArray<string>,
  isComplete: boolean,
): ForOfBindingDescriptor | null => {
  if (
    !ts.isVariableDeclarationList(variableDeclaration.parent) ||
    !ts.isForOfStatement(variableDeclaration.parent.parent)
  ) {
    return null;
  }
  return {
    forOfStatement: variableDeclaration.parent.parent,
    isComplete,
    propertyPath,
    variableDeclaration,
  };
};

export const getForOfBindingDescriptor = (
  declaration: ts.Declaration,
): ForOfBindingDescriptor | null => {
  if (ts.isVariableDeclaration(declaration)) {
    return ts.isIdentifier(declaration.name)
      ? createForOfBindingDescriptor(declaration, [], true)
      : null;
  }
  if (!ts.isBindingElement(declaration)) return null;

  const propertyPath: string[] = [];
  let isComplete = true;
  let currentBindingElement = declaration;
  while (true) {
    const bindingPattern = currentBindingElement.parent;
    isComplete = isComplete && isBindingPatternComplete(bindingPattern);
    if (ts.isObjectBindingPattern(bindingPattern)) {
      const propertyName = getObjectBindingPropertyName(currentBindingElement);
      if (propertyName) {
        propertyPath.unshift(propertyName);
      } else {
        isComplete = false;
      }
    } else {
      const elementIndex = bindingPattern.elements.indexOf(currentBindingElement);
      if (elementIndex < 0) {
        isComplete = false;
      } else {
        propertyPath.unshift(String(elementIndex));
      }
    }

    const parentDeclaration = bindingPattern.parent;
    if (ts.isVariableDeclaration(parentDeclaration)) {
      return createForOfBindingDescriptor(parentDeclaration, propertyPath, isComplete);
    }
    if (!ts.isBindingElement(parentDeclaration)) return null;
    currentBindingElement = parentDeclaration;
  }
};
