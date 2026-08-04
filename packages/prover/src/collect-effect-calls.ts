import ts from "typescript";
import { collectHookCalls } from "./collect-hook-calls.js";
import { REACT_EFFECT_HOOK_NAMES } from "./constants.js";

export const collectEffectCalls = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ts.CallExpression> =>
  collectHookCalls(functionNode, REACT_EFFECT_HOOK_NAMES, typeChecker);
