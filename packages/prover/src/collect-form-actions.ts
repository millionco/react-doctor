import ts from "typescript";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactFormActionKind, ReactFormActionStatus, ReactUnitKind } from "./types.js";
import { doesTypeContainCallable } from "./resolve-callable-expression.js";
import { collectJsxSpreadProperties } from "./utils/collect-jsx-spread-properties.js";
import { isEffectiveJsxPropertySource } from "./utils/is-effective-jsx-property-source.js";
import { isIntrinsicJsxElement } from "./utils/is-intrinsic-jsx-element.js";
import type { ReactUnitDescriptor } from "./types.js";

export interface FormActionDescriptor {
  actionExpression: ts.Expression;
  evidenceNode: ts.JsxAttributeLike;
  isSpread: boolean;
  kind: ReactFormActionKind;
  propertyName: string;
  status: ReactFormActionStatus;
}

const getJsxAttributeExpression = (attribute: ts.JsxAttribute): ts.Expression | null =>
  attribute.initializer &&
  ts.isJsxExpression(attribute.initializer) &&
  attribute.initializer.expression
    ? attribute.initializer.expression
    : null;

const getStaticAttributeValue = (
  openingElement: ts.JsxOpeningLikeElement,
  attributeName: string,
): string | null | undefined => {
  const attribute = openingElement.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === attributeName,
  );
  if (!attribute || !ts.isJsxAttribute(attribute)) return undefined;
  if (!attribute.initializer) return "";
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteralLike(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }
  return null;
};

const isStaticallyNestedInForm = (openingElement: ts.JsxOpeningLikeElement): boolean => {
  let currentNode: ts.Node = openingElement;
  while (currentNode.parent) {
    currentNode = currentNode.parent;
    if (
      ts.isJsxElement(currentNode) &&
      ts.isIdentifier(currentNode.openingElement.tagName) &&
      currentNode.openingElement.tagName.text === "form"
    ) {
      return true;
    }
    if (isFunctionBoundary(currentNode)) return false;
  }
  return false;
};

const getActionControl = (
  openingElement: ts.JsxOpeningLikeElement,
  propertyName: string,
): {
  kind: ReactFormActionKind;
  status: ReactFormActionStatus;
} => {
  if (!ts.isIdentifier(openingElement.tagName)) {
    return {
      kind: ReactFormActionKind.Form,
      status: ReactFormActionStatus.UnsupportedControl,
    };
  }
  const tagName = openingElement.tagName.text;
  if (tagName === "form" && propertyName === "action") {
    return { kind: ReactFormActionKind.Form, status: ReactFormActionStatus.Resolved };
  }
  if (tagName === "button" && propertyName === "formAction") {
    const typeValue = getStaticAttributeValue(openingElement, "type");
    if (typeValue === null) {
      return { kind: ReactFormActionKind.Submitter, status: ReactFormActionStatus.Opaque };
    }
    if (typeValue !== undefined && typeValue !== "" && typeValue !== "submit") {
      return {
        kind: ReactFormActionKind.Submitter,
        status: ReactFormActionStatus.UnsupportedControl,
      };
    }
    const formAssociation = getStaticAttributeValue(openingElement, "form");
    return {
      kind: ReactFormActionKind.Submitter,
      status:
        formAssociation === undefined && isStaticallyNestedInForm(openingElement)
          ? ReactFormActionStatus.Resolved
          : ReactFormActionStatus.Opaque,
    };
  }
  if (tagName === "input" && propertyName === "formAction") {
    const typeValue = getStaticAttributeValue(openingElement, "type");
    if (typeValue === null) {
      return { kind: ReactFormActionKind.Submitter, status: ReactFormActionStatus.Opaque };
    }
    if (typeValue !== "image" && typeValue !== "submit") {
      return {
        kind: ReactFormActionKind.Submitter,
        status: ReactFormActionStatus.UnsupportedControl,
      };
    }
    const formAssociation = getStaticAttributeValue(openingElement, "form");
    return {
      kind: ReactFormActionKind.Submitter,
      status:
        formAssociation === undefined && isStaticallyNestedInForm(openingElement)
          ? ReactFormActionStatus.Resolved
          : ReactFormActionStatus.Opaque,
    };
  }
  return {
    kind: propertyName === "action" ? ReactFormActionKind.Form : ReactFormActionKind.Submitter,
    status: ReactFormActionStatus.UnsupportedControl,
  };
};

export const collectFormActions = (
  unit: ReactUnitDescriptor,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<FormActionDescriptor> => {
  const functionNode = unit.functionNode;
  if (
    !functionNode ||
    unit.kind === ReactUnitKind.ClassComponent ||
    unit.kind === ReactUnitKind.InvalidHookOwner
  ) {
    return [];
  }
  const actions = new Map<string, FormActionDescriptor>();
  for (const reachableFunction of collectReachableFunctions(functionNode, typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        isIntrinsicJsxElement(node)
      ) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute)) {
            const propertyName = attribute.name.getText();
            if (
              (propertyName !== "action" && propertyName !== "formAction") ||
              !isEffectiveJsxPropertySource(attribute, propertyName, typeChecker)
            ) {
              continue;
            }
            const actionExpression = getJsxAttributeExpression(attribute);
            if (
              !actionExpression ||
              !doesTypeContainCallable(typeChecker.getTypeAtLocation(actionExpression), typeChecker)
            ) {
              continue;
            }
            actions.set(`${attribute.getSourceFile().fileName}:${attribute.getStart()}`, {
              actionExpression,
              evidenceNode: attribute,
              isSpread: false,
              propertyName,
              ...getActionControl(node, propertyName),
            });
            continue;
          }
          const spreadProperties = collectJsxSpreadProperties(attribute.expression, typeChecker);
          for (const propertyName of spreadProperties.callablePropertyNames) {
            if (
              (propertyName !== "action" && propertyName !== "formAction") ||
              !isEffectiveJsxPropertySource(attribute, propertyName, typeChecker)
            ) {
              continue;
            }
            actions.set(
              `${attribute.getSourceFile().fileName}:${attribute.getStart()}:${propertyName}`,
              {
                actionExpression: attribute.expression,
                evidenceNode: attribute,
                isSpread: true,
                propertyName,
                ...getActionControl(node, propertyName),
              },
            );
          }
        }
      }
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return [...actions.values()];
};
