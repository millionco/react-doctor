import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { readScopedCssFormatter } from "./read-scoped-css-formatter.js";
import { isBoundedPrimitiveCssToken } from "./validate-owned-css-token-values.js";
const KEY = "\uFFF0",
  VALUE = "\uFFF1";
const clean = (text: string): boolean => /^[\x20-\x7e]*$/u.test(text) && !text.includes("\\");
/** Finite custom-property stylesheet skeleton. Dynamic atoms/keys still need
 * validateOwnedCssTokenValues; source literals cannot introduce at-rules/imports.
 */
export function hasBoundedCssFormatterSkeleton(
  formatter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean {
  const proof = readScopedCssFormatter(formatter, scopes);
  if (!proof || !isNodeOfType(formatter, "FunctionDeclaration") || !formatter.body) return false;
  const keys = new Set<number>();
  let output: number | null = null;
  let level = 0;
  const rendered = (node: EsTreeNode): string | null => {
    if (isNodeOfType(node, "Literal"))
      return typeof node.value === "string" && clean(node.value) && !node.raw?.includes("\\")
        ? node.value
        : null;
    if (!isNodeOfType(node, "TemplateLiteral")) return null;
    let text = "";
    for (let i = 0; i < node.quasis.length; i++) {
      const quasi = node.quasis[i];
      if (!clean(quasi.value.cooked ?? "") || quasi.value.raw.includes("\\")) return null;
      text += quasi.value.cooked ?? "";
      if (i < node.expressions.length) {
        const expr = node.expressions[i];
        if (isNodeOfType(expr, "Identifier")) {
          const symbol = scopes.symbolFor(expr);
          text += symbol && keys.has(symbol.id) ? KEY : VALUE;
        } else if (
          isNodeOfType(expr, "CallExpression") &&
          isNodeOfType(expr.callee, "Identifier") &&
          scopes.symbolFor(expr.callee)?.id === proof.stringKeyHelper.id
        )
          text += KEY;
        else if (isNodeOfType(expr, "Literal")) {
          if (
            (typeof expr.value !== "string" && typeof expr.value !== "number") ||
            !isBoundedPrimitiveCssToken(expr.value)
          )
            return null;
          text += VALUE;
        } else text += VALUE;
      }
    }
    return text;
  };
  const line = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return true;
    // A whole static comment must open and close within this one push, never
    // across a hole, adjacent push or line. Directive/escape/control text refused.
    if (trimmed.startsWith("/*")) return /^\/\*[^*\\@\uFFF0\uFFF1]*\*\/$/u.test(trimmed);
    if (trimmed === ":root {") {
      if (level !== 0) return false;
      level = 1;
      return true;
    }
    const selector = new RegExp(`^:root\\[data-[a-z][a-z0-9-]*="${KEY}"\\] \\{$`, "u");
    if (selector.test(trimmed)) {
      if (level !== 0) return false;
      level = 1;
      return true;
    }
    if (trimmed === "}") {
      if (level !== 1) return false;
      level = 0;
      return true;
    }
    if (level !== 1) return false;
    const declaration = /^--([^:]+):\s*(.*);$/u.exec(trimmed);
    if (!declaration || declaration[1].includes(VALUE)) return false;
    if (!/^[a-z][a-z0-9-]*$/u.test(declaration[1].replaceAll(KEY, "safe-key"))) return false;
    const value = declaration[2];
    if (value === VALUE || value === KEY || value === VALUE + "ms") return true;
    return !value.includes(KEY) && !value.includes(VALUE) && isBoundedPrimitiveCssToken(value);
  };
  const walk = (body: readonly EsTreeNode[], loopEntry: number | null): boolean => {
    for (const node of body) {
      if (isNodeOfType(node, "VariableDeclaration")) {
        for (const d of node.declarations)
          if (isNodeOfType(d.id, "Identifier") && isNodeOfType(d.init, "ArrayExpression"))
            output = scopes.symbolFor(d.id)?.id ?? null;
        continue;
      }
      if (isNodeOfType(node, "ReturnStatement")) continue;
      if (isNodeOfType(node, "IfStatement")) {
        if (loopEntry === null || level !== loopEntry) return false;
        continue;
      }
      if (
        isNodeOfType(node, "ForOfStatement") &&
        isNodeOfType(node.left, "VariableDeclaration") &&
        isNodeOfType(node.body, "BlockStatement")
      ) {
        const pattern = node.left.declarations[0].id;
        if (
          !isNodeOfType(pattern, "ArrayPattern") ||
          !isNodeOfType(pattern.elements[0], "Identifier")
        )
          return false;
        const symbol = scopes.symbolFor(pattern.elements[0]);
        if (!symbol) return false;
        keys.add(symbol.id);
        const before = level;
        if (!walk(node.body.body, before) || level !== before) return false;
        continue;
      }
      if (
        !isNodeOfType(node, "ExpressionStatement") ||
        !isNodeOfType(node.expression, "CallExpression") ||
        !isNodeOfType(node.expression.callee, "MemberExpression") ||
        !isNodeOfType(node.expression.callee.object, "Identifier") ||
        scopes.symbolFor(node.expression.callee.object)?.id !== output
      )
        return false;
      const text = rendered(node.expression.arguments[0]);
      if (text === null || !line(text)) return false;
    }
    return true;
  };
  return walk(formatter.body.body, null) && level === 0;
}
