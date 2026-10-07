import type { AstNode } from "@shaderfrog/glsl-parser/ast/ast-types.js";

export const getGlslNumericConstant = (node: AstNode): number | null => {
  let value: number | null = null;
  if (node.type === "float_constant") {
    value = Number(node.token.replace(/(?:lf|LF|f|F)$/, ""));
  } else if (node.type === "double_constant") {
    value = Number(node.token.replace(/(?:lf|LF)$/, ""));
  } else if (node.type === "uint_constant") {
    value = Number(node.token.replace(/[uU]$/, ""));
  } else if (node.type === "int_constant") {
    value = Number(node.token);
  } else if (node.type === "group") {
    value = getGlslNumericConstant(node.expression);
  } else if (
    node.type === "unary" &&
    (node.operator.literal === "+" || node.operator.literal === "-")
  ) {
    const operand = getGlslNumericConstant(node.expression);
    if (operand !== null) value = node.operator.literal === "-" ? -operand : operand;
  }
  return value !== null && Number.isFinite(value) ? value : null;
};
