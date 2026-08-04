import ts from "typescript";

export const collectBindingIdentifiers = (
  bindingName: ts.BindingName,
): ReadonlyArray<ts.Identifier> => {
  if (ts.isIdentifier(bindingName)) return [bindingName];
  const identifiers: ts.Identifier[] = [];
  for (const bindingElement of bindingName.elements) {
    if (!ts.isBindingElement(bindingElement)) continue;
    identifiers.push(...collectBindingIdentifiers(bindingElement.name));
  }
  return identifiers;
};
