import ts from "typescript";
import { PLATFORM_OBSERVER_KINDS } from "../constants.js";
import { ReactEffectResourceKind } from "../types.js";
import { getResolvedSymbol } from "./get-resolved-symbol.js";
import { isPlatformDeclarationSymbol } from "./is-platform-declaration-symbol.js";

const isPlatformMember = (
  node: ts.Node,
  expectedName: string,
  typeChecker: ts.TypeChecker,
): boolean => {
  const symbol = getResolvedSymbol(node, typeChecker);
  return Boolean(
    symbol && symbol.getName() === expectedName && isPlatformDeclarationSymbol(symbol),
  );
};

const getObserverKind = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ReactEffectResourceKind | null => {
  const expressionType = typeChecker.getTypeAtLocation(expression);
  const typeNames = expressionType.isUnionOrIntersection()
    ? expressionType.types.map((memberType) => memberType.getSymbol()?.getName())
    : [expressionType.getSymbol()?.getName()];
  const kinds = [
    ...new Set(
      typeNames.flatMap((typeName) => {
        const kind = typeName ? PLATFORM_OBSERVER_KINDS.get(typeName) : null;
        return kind ? [kind] : [];
      }),
    ),
  ];
  return kinds.length === 1 ? (kinds[0] ?? null) : null;
};

export const getPlatformEffectResourceKind = (
  callExpression: ts.CallExpression,
  typeChecker: ts.TypeChecker,
): ReactEffectResourceKind | null => {
  if (!ts.isPropertyAccessExpression(callExpression.expression)) return null;
  if (
    callExpression.expression.name.text === "addEventListener" &&
    isPlatformMember(callExpression.expression.name, "addEventListener", typeChecker)
  ) {
    return ReactEffectResourceKind.EventListener;
  }
  if (
    callExpression.expression.name.text === "observe" &&
    isPlatformMember(callExpression.expression.name, "observe", typeChecker)
  ) {
    return (
      getObserverKind(callExpression.expression.expression, typeChecker) ??
      ReactEffectResourceKind.Observer
    );
  }
  return null;
};
