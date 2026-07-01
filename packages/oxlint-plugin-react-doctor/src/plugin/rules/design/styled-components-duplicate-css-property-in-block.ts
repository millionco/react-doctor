import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// Opaque marker substituted for each `${...}` interpolation while scanning
// the CSS text, so an interpolation never contributes a `;`/`{`/`}`/`:`
// separator of its own.
const INTERPOLATION_MARKER = "\u0000";
const CSS_PROPERTY_PATTERN = /^-?[a-z][a-z-]*$/;

interface CssDeclaration {
  readonly property: string;
  readonly isConditional: boolean;
}

// The unwrapped root identifier of a tagged-template tag: `styled` for
// `styled.div` / `styled(Comp)` / `styled.div.attrs(...)`, or `css` for the
// `css` helper. Anything else returns null.
const getTagRootName = (tag: EsTreeNode): string | null => {
  let current: EsTreeNode = tag;
  while (true) {
    if (isNodeOfType(current, "Identifier")) return current.name;
    if (isNodeOfType(current, "MemberExpression")) {
      current = current.object;
      continue;
    }
    if (isNodeOfType(current, "CallExpression")) {
      current = current.callee;
      continue;
    }
    return null;
  }
};

// A `${props => cond ? a : b}` (or a concise/return-body ternary): the shape
// that signals the author expected this to be the effective value, so
// silently losing it to a later same-property declaration is the bug.
const isTernaryInterpolation = (
  expression: EsTreeNode | undefined
): boolean => {
  if (!expression) return false;
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ConditionalExpression")) return true;
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    const body = stripped.body;
    if (isNodeOfType(body, "ConditionalExpression")) return true;
    if (isNodeOfType(body, "BlockStatement")) {
      return body.body.some(
        (statement) =>
          isNodeOfType(statement, "ReturnStatement") &&
          Boolean(statement.argument) &&
          isNodeOfType(
            stripParenExpression(statement.argument as EsTreeNode),
            "ConditionalExpression"
          )
      );
    }
  }
  return false;
};

const finalizeDeclaration = (
  text: string,
  hasTernary: boolean,
  declarations: CssDeclaration[]
): void => {
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) return;
  const property = text.slice(0, colonIndex).trim().toLowerCase();
  if (
    !property ||
    property.startsWith("--") ||
    !CSS_PROPERTY_PATTERN.test(property)
  )
    return;
  declarations.push({ property, isConditional: hasTernary });
};

// Scan the interleaved static text + interpolations, collecting only the
// declarations at the top brace level (depth 0). Declarations inside nested
// selectors, pseudo-classes, and @media/@supports blocks live at depth > 0
// and are intentionally skipped — that cascade is deliberate.
const collectTopLevelDeclarations = (
  template: EsTreeNodeOfType<"TemplateLiteral">
): CssDeclaration[] => {
  const declarations: CssDeclaration[] = [];
  let braceDepth = 0;
  let currentText = "";
  let currentHasTernary = false;
  const resetSegment = (): void => {
    currentText = "";
    currentHasTernary = false;
  };

  template.quasis.forEach((quasi, quasiIndex) => {
    const staticText = quasi.value.cooked ?? quasi.value.raw ?? "";
    for (const character of staticText) {
      if (character === "{") {
        braceDepth += 1;
        resetSegment();
      } else if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        resetSegment();
      } else if (character === ";") {
        if (braceDepth === 0)
          finalizeDeclaration(currentText, currentHasTernary, declarations);
        resetSegment();
      } else {
        currentText += character;
      }
    }
    const expression = template.expressions[quasiIndex];
    if (expression && braceDepth === 0) {
      currentText += INTERPOLATION_MARKER;
      if (isTernaryInterpolation(expression)) currentHasTernary = true;
    }
  });
  return declarations;
};

export const styledComponentsDuplicateCssPropertyInBlock = defineRule({
  id: "styled-components-duplicate-css-property-in-block",
  title: "Duplicate CSS property in styled block",
  severity: "warn",
  requires: ["styled-components"],
  recommendation:
    "Merge repeated declarations of the same CSS property in a styled block into one, so a later conditional value doesn't silently override an earlier one.",
  create: (context) => ({
    TaggedTemplateExpression(
      node: EsTreeNodeOfType<"TaggedTemplateExpression">
    ) {
      const rootName = getTagRootName(node.tag);
      if (rootName !== "styled" && rootName !== "css") return;

      const declarations = collectTopLevelDeclarations(node.quasi);
      const occurrencesByProperty = new Map<string, CssDeclaration[]>();
      for (const declaration of declarations) {
        const existing = occurrencesByProperty.get(declaration.property);
        if (existing) existing.push(declaration);
        else occurrencesByProperty.set(declaration.property, [declaration]);
      }

      for (const [property, occurrences] of occurrencesByProperty) {
        if (occurrences.length < 2) continue;
        if (!occurrences.every((occurrence) => occurrence.isConditional))
          continue;
        context.report({
          node,
          message: `The CSS property \`${property}\` is declared ${occurrences.length} times at the same level here, so the last conditional value always wins and the earlier ones never apply — merge them into a single declaration.`,
        });
      }
    },
  }),
});
