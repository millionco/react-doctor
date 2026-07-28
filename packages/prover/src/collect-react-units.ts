import ts from "typescript";
import * as path from "node:path";
import { collectDirectHookCalls } from "./collect-direct-hook-calls.js";
import { getFunctionName } from "./get-function-name.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { ReactUnitKind } from "./types.js";
import type { ReactUnitDescriptor } from "./types.js";

const isReactComponentName = (name: string): boolean => /^[A-Z]/.test(name);

const isReactComponentClass = (classNode: ts.ClassDeclaration): boolean =>
  Boolean(
    classNode.heritageClauses?.some((heritageClause) =>
      heritageClause.types.some((heritageType) => {
        const heritageName = heritageType.expression.getText();
        return heritageName === "Component" || heritageName.endsWith(".Component");
      }),
    ),
  );

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
        }
      : null;
  }
  if (isReactHookName(functionName)) {
    return {
      name: functionName,
      kind: ReactUnitKind.Hook,
      node: functionNode,
      functionNode,
    };
  }
  if (isReactComponentName(functionName)) {
    return {
      name: functionName,
      kind: ReactUnitKind.Component,
      node: functionNode,
      functionNode,
    };
  }
  if (directHookCalls.length === 0) return null;
  return {
    name: functionName,
    kind: ReactUnitKind.InvalidHookOwner,
    node: functionNode,
    functionNode,
    invalidHookCalls: directHookCalls,
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
    });
  }
  const visit = (node: ts.Node): void => {
    if (isFunctionBoundary(node)) {
      const functionUnit = collectFunctionUnit(node, typeChecker);
      if (functionUnit) units.push(functionUnit);
    } else if (ts.isClassDeclaration(node) && isReactComponentClass(node)) {
      units.push({
        name: node.name?.text ?? "DefaultComponent",
        kind: ReactUnitKind.ClassComponent,
        node,
      });
    }
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return units;
};
