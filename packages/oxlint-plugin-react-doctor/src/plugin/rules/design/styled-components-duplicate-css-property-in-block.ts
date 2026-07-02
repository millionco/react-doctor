import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProvenStyledComponentExpression } from "../../utils/is-proven-styled-component-expression.js";
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
  readonly ternaryTests: TernaryTest[];
}

interface TernaryTest {
  readonly expression: EsTreeNode;
  readonly parameterName: string | null;
}

const getTagRootIdentifier = (tag: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode = tag;
  while (true) {
    if (isNodeOfType(current, "Identifier")) return current;
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

const getTernaryInterpolationTest = (expression: EsTreeNode | undefined): TernaryTest | null => {
  if (!expression) return null;
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return { expression: stripped.test, parameterName: null };
  }
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    const firstParameter = stripped.params[0];
    const parameterName =
      stripped.params.length === 1 && isNodeOfType(firstParameter, "Identifier")
        ? firstParameter.name
        : null;
    const body = stripParenExpression(stripped.body);
    if (isNodeOfType(body, "ConditionalExpression")) {
      return { expression: body.test, parameterName };
    }
    if (isNodeOfType(body, "BlockStatement")) {
      for (const statement of body.body) {
        if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) continue;
        const returnedExpression = stripParenExpression(statement.argument);
        if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
          return { expression: returnedExpression.test, parameterName };
        }
      }
    }
  }
  return null;
};

const areTestsEquivalent = (left: TernaryTest, right: TernaryTest): boolean => {
  if (areExpressionsStructurallyEqual(left.expression, right.expression)) return true;
  if (!left.parameterName || !right.parameterName) return false;

  const compare = (leftNode: EsTreeNode, rightNode: EsTreeNode): boolean => {
    const unwrappedLeft = stripParenExpression(leftNode);
    const unwrappedRight = stripParenExpression(rightNode);
    if (unwrappedLeft.type !== unwrappedRight.type) return false;
    if (isNodeOfType(unwrappedLeft, "Identifier") && isNodeOfType(unwrappedRight, "Identifier")) {
      if (
        unwrappedLeft.name === left.parameterName &&
        unwrappedRight.name === right.parameterName
      ) {
        return true;
      }
      return unwrappedLeft.name === unwrappedRight.name;
    }
    if (isNodeOfType(unwrappedLeft, "Literal") && isNodeOfType(unwrappedRight, "Literal")) {
      return unwrappedLeft.value === unwrappedRight.value;
    }
    if (
      isNodeOfType(unwrappedLeft, "MemberExpression") &&
      isNodeOfType(unwrappedRight, "MemberExpression")
    ) {
      return (
        unwrappedLeft.computed === unwrappedRight.computed &&
        compare(unwrappedLeft.object, unwrappedRight.object) &&
        compare(unwrappedLeft.property, unwrappedRight.property)
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "UnaryExpression") &&
      isNodeOfType(unwrappedRight, "UnaryExpression")
    ) {
      return (
        unwrappedLeft.operator === unwrappedRight.operator &&
        compare(unwrappedLeft.argument, unwrappedRight.argument)
      );
    }
    if (
      (isNodeOfType(unwrappedLeft, "BinaryExpression") ||
        isNodeOfType(unwrappedLeft, "LogicalExpression")) &&
      (isNodeOfType(unwrappedRight, "BinaryExpression") ||
        isNodeOfType(unwrappedRight, "LogicalExpression"))
    ) {
      return (
        unwrappedLeft.type === unwrappedRight.type &&
        unwrappedLeft.operator === unwrappedRight.operator &&
        compare(unwrappedLeft.left, unwrappedRight.left) &&
        compare(unwrappedLeft.right, unwrappedRight.right)
      );
    }
    return false;
  };

  return compare(left.expression, right.expression);
};

const finalizeDeclaration = (
  text: string,
  ternaryTests: TernaryTest[],
  declarations: CssDeclaration[],
): void => {
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) return;
  const property = text.slice(0, colonIndex).trim().toLowerCase();
  if (!property || property.startsWith("--") || !CSS_PROPERTY_PATTERN.test(property)) return;
  declarations.push({ property, isConditional: ternaryTests.length > 0, ternaryTests });
};

// Scan the interleaved static text + interpolations, collecting only the
// declarations at the top brace level (depth 0). Declarations inside nested
// selectors, pseudo-classes, and @media/@supports blocks live at depth > 0
// and are intentionally skipped — that cascade is deliberate.
const collectTopLevelDeclarations = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
): CssDeclaration[] => {
  const declarations: CssDeclaration[] = [];
  let braceDepth = 0;
  let currentText = "";
  let currentTernaryTests: TernaryTest[] = [];
  let activeQuote: '"' | "'" | null = null;
  let isEscaped = false;
  let isInsideComment = false;
  const resetSegment = (): void => {
    currentText = "";
    currentTernaryTests = [];
  };

  template.quasis.forEach((quasi, quasiIndex) => {
    const staticText = quasi.value.cooked ?? quasi.value.raw ?? "";
    for (let characterIndex = 0; characterIndex < staticText.length; characterIndex += 1) {
      const character = staticText[characterIndex];
      const nextCharacter = staticText[characterIndex + 1];
      if (isInsideComment) {
        if (character === "*" && nextCharacter === "/") {
          isInsideComment = false;
          characterIndex += 1;
        }
        continue;
      }
      if (activeQuote) {
        currentText += character;
        if (isEscaped) {
          isEscaped = false;
        } else if (character === "\\") {
          isEscaped = true;
        } else if (character === activeQuote) {
          activeQuote = null;
        }
        continue;
      }
      if (character === "/" && nextCharacter === "*") {
        isInsideComment = true;
        characterIndex += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        activeQuote = character;
        currentText += character;
        continue;
      }
      if (character === "{") {
        braceDepth += 1;
        resetSegment();
      } else if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        resetSegment();
      } else if (character === ";") {
        if (braceDepth === 0) finalizeDeclaration(currentText, currentTernaryTests, declarations);
        resetSegment();
      } else {
        currentText += character;
      }
    }
    const expression = template.expressions[quasiIndex];
    if (expression && braceDepth === 0 && !activeQuote && !isInsideComment) {
      currentText += INTERPOLATION_MARKER;
      const ternaryTest = getTernaryInterpolationTest(expression);
      if (ternaryTest) currentTernaryTests.push(ternaryTest);
    }
  });
  if (braceDepth === 0) finalizeDeclaration(currentText, currentTernaryTests, declarations);
  return declarations;
};

const isProvenCssHelperTag = (tag: EsTreeNode): boolean => {
  const rootIdentifier = getTagRootIdentifier(tag);
  if (!rootIdentifier || !isNodeOfType(rootIdentifier, "Identifier")) return false;
  const importBinding = getImportBindingForName(rootIdentifier, rootIdentifier.name);
  if (!importBinding || importBinding.source !== "styled-components") return false;
  if (!importBinding.isNamespace) return importBinding.exportedName === "css";
  return isNodeOfType(tag, "MemberExpression") && getStaticPropertyName(tag) === "css";
};

export const styledComponentsDuplicateCssPropertyInBlock = defineRule({
  id: "styled-components-duplicate-css-property-in-block",
  title: "Duplicate CSS property in styled block",
  severity: "warn",
  requires: ["styled-components"],
  recommendation:
    "Merge repeated declarations of the same CSS property in a styled block into one, so a later conditional value doesn't silently override an earlier one.",
  create: (context) => ({
    TaggedTemplateExpression(node: EsTreeNodeOfType<"TaggedTemplateExpression">) {
      if (
        !isProvenStyledComponentExpression(node, context.scopes) &&
        !isProvenCssHelperTag(node.tag)
      ) {
        return;
      }

      const declarations = collectTopLevelDeclarations(node.quasi);
      const occurrencesByProperty = new Map<string, CssDeclaration[]>();
      for (const declaration of declarations) {
        const existing = occurrencesByProperty.get(declaration.property);
        if (existing) existing.push(declaration);
        else occurrencesByProperty.set(declaration.property, [declaration]);
      }

      for (const [property, occurrences] of occurrencesByProperty) {
        if (occurrences.length < 2) continue;
        if (!occurrences.every((occurrence) => occurrence.isConditional)) continue;
        const firstTests = occurrences[0].ternaryTests;
        const allTestsEqual = occurrences.every(
          (occurrence) =>
            occurrence.ternaryTests.length === firstTests.length &&
            occurrence.ternaryTests.every((test, testIndex) =>
              areTestsEquivalent(test, firstTests[testIndex]),
            ),
        );
        if (allTestsEqual) continue;
        context.report({
          node,
          message: `The CSS property \`${property}\` is declared ${occurrences.length} times at the same level here, so the last conditional value always wins and the earlier ones never apply — merge them into a single declaration.`,
        });
      }
    },
  }),
});
