import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface StaticJsonLiteralResult {
  readonly value: unknown;
}

export const parseStaticJsonLiteral = (argument: EsTreeNode): StaticJsonLiteralResult | null => {
  let literalText: string | null = null;
  if (isNodeOfType(argument, "Literal") && typeof argument.value === "string") {
    literalText = argument.value;
  } else if (isNodeOfType(argument, "TemplateLiteral") && argument.expressions.length === 0) {
    literalText = argument.quasis[0]?.value.cooked ?? null;
  }
  if (literalText === null) return null;
  try {
    const value: unknown = JSON.parse(literalText);
    return { value };
  } catch {
    return null;
  }
};
