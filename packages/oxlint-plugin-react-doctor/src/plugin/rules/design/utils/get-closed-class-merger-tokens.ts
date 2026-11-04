import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { splitTailwindClassName } from "../../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT,
  CLOSED_CLASS_MERGER_STRING_LENGTH_LIMIT,
} from "./closed-class-merger/constants.js";
import { getClosedClassStringAlternatives } from "./get-closed-class-string-alternatives.js";
import { isCanonicalClassMerger } from "./is-canonical-class-merger.js";

export const getClosedClassMergerTokens = (
  expression: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<string> | null => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isCanonicalClassMerger(call.callee, context)
  )
    return null;
  let alternatives = [""];
  for (const argument of call.arguments) {
    const values = getClosedClassStringAlternatives(argument, context.scopes);
    if (!values || alternatives.length * values.length > CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT)
      return null;
    const combined = new Set<string>();
    for (const previous of alternatives) {
      for (const value of values) {
        const joined = clsx(previous, value);
        if (joined.length > CLOSED_CLASS_MERGER_STRING_LENGTH_LIMIT) return null;
        combined.add(joined);
      }
    }
    alternatives = [...combined];
  }
  let surviving: Set<string> | null = null;
  for (const alternative of alternatives) {
    const tokens = new Set(splitTailwindClassName(twMerge(alternative)));
    if (surviving === null) {
      surviving = tokens;
    } else {
      surviving = new Set([...surviving].filter((token: string) => tokens.has(token)));
    }
  }
  return surviving ? [...surviving] : [];
};
