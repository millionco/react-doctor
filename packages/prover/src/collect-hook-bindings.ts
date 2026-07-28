import ts from "typescript";
import { collectEffectEventBindings } from "./collect-effect-event-bindings.js";
import { REACT_TRANSITION_STARTER_INDEX } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { isFunctionBoundary } from "./is-function-boundary.js";

export interface HookBindings {
  effectEvents: ReadonlySet<ts.Symbol>;
  refs: ReadonlySet<ts.Symbol>;
  stateSetters: ReadonlySet<ts.Symbol>;
  stateValueBySetter: ReadonlyMap<ts.Symbol, ts.Symbol>;
  stateValues: ReadonlySet<ts.Symbol>;
  transitionStarters: ReadonlySet<ts.Symbol>;
}

const getBindingSymbol = (
  bindingName: ts.BindingName | undefined,
  typeChecker: ts.TypeChecker,
): ts.Symbol | null => {
  if (!bindingName || !ts.isIdentifier(bindingName)) return null;
  return typeChecker.getSymbolAtLocation(bindingName) ?? null;
};

export const collectHookBindings = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): HookBindings => {
  const effectEvents = new Set(
    collectEffectEventBindings(functionNode, typeChecker).map((binding) => binding.symbol),
  );
  const refs = new Set<ts.Symbol>();
  const stateSetters = new Set<ts.Symbol>();
  const stateValueBySetter = new Map<ts.Symbol, ts.Symbol>();
  const stateValues = new Set<ts.Symbol>();
  const transitionStarters = new Set<ts.Symbol>();
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) {
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callName = getCanonicalReactApiName(node.initializer.expression, typeChecker);
      if (
        (callName === "useState" || callName === "useReducer") &&
        ts.isArrayBindingPattern(node.name)
      ) {
        const stateBinding = node.name.elements[0];
        const setterBinding = node.name.elements[1];
        const stateBindingName =
          stateBinding && ts.isBindingElement(stateBinding) ? stateBinding.name : undefined;
        const setterBindingName =
          setterBinding && ts.isBindingElement(setterBinding) ? setterBinding.name : undefined;
        const stateSymbol = getBindingSymbol(stateBindingName, typeChecker);
        const setterSymbol = getBindingSymbol(setterBindingName, typeChecker);
        if (stateSymbol) stateValues.add(stateSymbol);
        if (setterSymbol) stateSetters.add(setterSymbol);
        if (callName === "useState" && stateSymbol && setterSymbol) {
          stateValueBySetter.set(setterSymbol, stateSymbol);
        }
      }
      if (callName === "useRef" && ts.isIdentifier(node.name)) {
        const refSymbol = getBindingSymbol(node.name, typeChecker);
        if (refSymbol) refs.add(refSymbol);
      }
      if (callName === "useTransition" && ts.isArrayBindingPattern(node.name)) {
        const starterBinding = node.name.elements[REACT_TRANSITION_STARTER_INDEX];
        const starterBindingName =
          starterBinding && ts.isBindingElement(starterBinding) ? starterBinding.name : undefined;
        const starterSymbol = getBindingSymbol(starterBindingName, typeChecker);
        if (starterSymbol) transitionStarters.add(starterSymbol);
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return {
    effectEvents,
    refs,
    stateSetters,
    stateValueBySetter,
    stateValues,
    transitionStarters,
  };
};
