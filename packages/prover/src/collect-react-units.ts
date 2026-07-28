import ts from "typescript";
import * as path from "node:path";
import { collectDirectHookCalls } from "./collect-direct-hook-calls.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getFunctionName } from "./get-function-name.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactUnitKind } from "./types.js";
import { getClassMethodDeclaration } from "./utils/get-class-method-declaration.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";
import type { ReactUnitDescriptor } from "./types.js";

const isReactComponentName = (name: string): boolean => /^[A-Z]/.test(name);

const REACT_CLASS_BASE_NAMES = new Set(["Component", "PureComponent"]);

const isReactComponentClass = (
  classNode: ts.ClassDeclaration,
  typeChecker: ts.TypeChecker,
): boolean =>
  Boolean(
    classNode.heritageClauses?.some((heritageClause) =>
      heritageClause.types.some((heritageType) =>
        REACT_CLASS_BASE_NAMES.has(
          getCanonicalReactApiName(heritageType.expression, typeChecker) ?? "",
        ),
      ),
    ),
  );

const SUPPORTED_CLASS_LIFECYCLE_NAMES = new Set([
  "componentDidMount",
  "componentWillUnmount",
  "render",
]);

const isReservedClassLifecycleName = (methodName: string): boolean =>
  methodName.startsWith("component") ||
  methodName.startsWith("UNSAFE_") ||
  methodName === "getSnapshotBeforeUpdate" ||
  methodName === "shouldComponentUpdate";

const hasSupportedClassSyntax = (
  classNode: ts.ClassDeclaration,
  renderMethod: ts.MethodDeclaration,
): boolean =>
  renderMethod.parameters.length === 0 &&
  classNode.members.every((member) => {
    if (ts.isPropertyDeclaration(member)) {
      const propertyName = getStaticPropertyName(member.name);
      const initializer = member.initializer;
      return Boolean(
        propertyName &&
        !member.modifiers?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.StaticKeyword ||
            modifier.kind === ts.SyntaxKind.AccessorKeyword,
        ) &&
        (!initializer ||
          ts.isNumericLiteral(initializer) ||
          initializer.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isIdentifier(initializer) && initializer.text === "undefined")),
      );
    }
    if (!ts.isMethodDeclaration(member)) return false;
    const methodName = getStaticPropertyName(member.name);
    if (!methodName || getClassMethodDeclaration(classNode, methodName) !== member) return false;
    if (isReservedClassLifecycleName(methodName)) {
      return (
        SUPPORTED_CLASS_LIFECYCLE_NAMES.has(methodName) &&
        (methodName === "render" || member.parameters.length === 0)
      );
    }
    return true;
  });

const collectFunctionUnit = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReactUnitDescriptor | null => {
  const functionName = getFunctionName(functionNode);
  const directHookCalls = collectDirectHookCalls(functionNode, typeChecker);
  if (!functionName) {
    return directHookCalls.length > 0
      ? {
          name: "anonymous callback",
          kind: ReactUnitKind.InvalidHookOwner,
          node: functionNode,
          functionNode,
          invalidHookCalls: directHookCalls,
          sourceComplete: false,
        }
      : null;
  }
  if (isReactHookName(functionName)) {
    return {
      name: functionName,
      kind: ReactUnitKind.Hook,
      node: functionNode,
      functionNode,
      sourceComplete: true,
    };
  }
  if (isReactComponentName(functionName)) {
    return {
      name: functionName,
      kind: ReactUnitKind.Component,
      node: functionNode,
      functionNode,
      sourceComplete: true,
    };
  }
  if (directHookCalls.length === 0) return null;
  return {
    name: functionName,
    kind: ReactUnitKind.InvalidHookOwner,
    node: functionNode,
    functionNode,
    invalidHookCalls: directHookCalls,
    sourceComplete: false,
  };
};

export const collectReactUnits = (
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ReactUnitDescriptor> => {
  const units: ReactUnitDescriptor[] = [];
  const moduleHookCalls = collectDirectHookCalls(sourceFile, typeChecker);
  if (moduleHookCalls.length > 0) {
    units.push({
      name: `${path.basename(sourceFile.fileName)} module`,
      kind: ReactUnitKind.InvalidHookOwner,
      node: sourceFile,
      invalidHookCalls: moduleHookCalls,
      sourceComplete: false,
    });
  }
  const visit = (node: ts.Node): void => {
    if (isFunctionBoundary(node)) {
      const functionUnit = collectFunctionUnit(node, typeChecker);
      if (functionUnit) units.push(functionUnit);
    } else if (ts.isClassDeclaration(node) && isReactComponentClass(node, typeChecker)) {
      const renderMethod = getClassMethodDeclaration(node, "render");
      units.push({
        name: node.name?.text ?? "DefaultComponent",
        kind: ReactUnitKind.ClassComponent,
        node,
        classNode: node,
        functionNode: renderMethod ?? undefined,
        sourceComplete: Boolean(renderMethod && hasSupportedClassSyntax(node, renderMethod)),
      });
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return units;
};
