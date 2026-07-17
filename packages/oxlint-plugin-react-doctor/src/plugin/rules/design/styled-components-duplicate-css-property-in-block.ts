import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getRootIdentifier } from "../../utils/get-root-identifier.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProvenStyledComponentExpression } from "../../utils/is-proven-styled-component-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
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
  readonly parameterBindings: ReadonlyMap<string, string> | null;
}

const collectCallbackParameterBindings = (
  parameter: EsTreeNode,
  sourcePath: string,
  bindings: Map<string, string>,
): boolean => {
  if (isNodeOfType(parameter, "Identifier")) {
    bindings.set(parameter.name, sourcePath);
    return true;
  }
  if (isNodeOfType(parameter, "AssignmentPattern")) {
    return collectCallbackParameterBindings(parameter.left, sourcePath, bindings);
  }
  if (isNodeOfType(parameter, "RestElement")) {
    return collectCallbackParameterBindings(parameter.argument, sourcePath, bindings);
  }
  if (isNodeOfType(parameter, "ObjectPattern")) {
    for (const property of parameter.properties) {
      if (!isNodeOfType(property, "Property")) return false;
      const propertyName = getStaticPropertyKeyName(property, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName === null) return false;
      if (
        !collectCallbackParameterBindings(property.value, `${sourcePath}.${propertyName}`, bindings)
      ) {
        return false;
      }
    }
    return true;
  }
  if (isNodeOfType(parameter, "ArrayPattern")) {
    for (let elementIndex = 0; elementIndex < parameter.elements.length; elementIndex += 1) {
      const element = parameter.elements[elementIndex];
      if (!element) continue;
      if (!collectCallbackParameterBindings(element, `${sourcePath}[${elementIndex}]`, bindings)) {
        return false;
      }
    }
    return true;
  }
  return false;
};

const getCallbackParameterBindings = (
  parameter: EsTreeNode | undefined,
): ReadonlyMap<string, string> | null => {
  if (!parameter) return null;
  const bindings = new Map<string, string>();
  return collectCallbackParameterBindings(parameter, "$", bindings) ? bindings : null;
};

const getTernaryInterpolationTest = (expression: EsTreeNode | undefined): TernaryTest | null => {
  if (!expression) return null;
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return { expression: stripped.test, parameterBindings: null };
  }
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    const firstParameter = stripped.params[0];
    const parameterBindings =
      stripped.params.length === 1 ? getCallbackParameterBindings(firstParameter) : null;
    const body = stripParenExpression(stripped.body);
    if (isNodeOfType(body, "ConditionalExpression")) {
      return { expression: body.test, parameterBindings };
    }
    if (isNodeOfType(body, "BlockStatement")) {
      for (const statement of body.body) {
        if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) continue;
        const returnedExpression = stripParenExpression(statement.argument);
        if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
          return { expression: returnedExpression.test, parameterBindings };
        }
      }
    }
  }
  return null;
};

const areTestsEquivalent = (left: TernaryTest, right: TernaryTest): boolean => {
  const compare = (leftNode: EsTreeNode, rightNode: EsTreeNode): boolean => {
    const unwrappedLeft = stripParenExpression(leftNode);
    const unwrappedRight = stripParenExpression(rightNode);
    if (unwrappedLeft.type !== unwrappedRight.type) return false;
    if (isNodeOfType(unwrappedLeft, "Identifier") && isNodeOfType(unwrappedRight, "Identifier")) {
      const leftParameterPath = left.parameterBindings?.get(unwrappedLeft.name);
      const rightParameterPath = right.parameterBindings?.get(unwrappedRight.name);
      if (leftParameterPath !== undefined || rightParameterPath !== undefined) {
        return leftParameterPath !== undefined && leftParameterPath === rightParameterPath;
      }
      return unwrappedLeft.name === unwrappedRight.name;
    }
    if (isNodeOfType(unwrappedLeft, "Literal") && isNodeOfType(unwrappedRight, "Literal")) {
      return unwrappedLeft.value === unwrappedRight.value;
    }
    if (isNodeOfType(unwrappedLeft, "ThisExpression")) return true;
    if (
      isNodeOfType(unwrappedLeft, "MemberExpression") &&
      isNodeOfType(unwrappedRight, "MemberExpression")
    ) {
      const leftPropertyName = getStaticPropertyName(unwrappedLeft);
      return (
        unwrappedLeft.computed === unwrappedRight.computed &&
        compare(unwrappedLeft.object, unwrappedRight.object) &&
        (unwrappedLeft.computed
          ? compare(unwrappedLeft.property, unwrappedRight.property)
          : leftPropertyName !== null && leftPropertyName === getStaticPropertyName(unwrappedRight))
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
    if (
      isNodeOfType(unwrappedLeft, "ConditionalExpression") &&
      isNodeOfType(unwrappedRight, "ConditionalExpression")
    ) {
      return (
        compare(unwrappedLeft.test, unwrappedRight.test) &&
        compare(unwrappedLeft.consequent, unwrappedRight.consequent) &&
        compare(unwrappedLeft.alternate, unwrappedRight.alternate)
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "SequenceExpression") &&
      isNodeOfType(unwrappedRight, "SequenceExpression")
    ) {
      return (
        unwrappedLeft.expressions.length === unwrappedRight.expressions.length &&
        unwrappedLeft.expressions.every((expression, expressionIndex) =>
          compare(expression, unwrappedRight.expressions[expressionIndex]),
        )
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "TemplateLiteral") &&
      isNodeOfType(unwrappedRight, "TemplateLiteral")
    ) {
      return (
        unwrappedLeft.quasis.length === unwrappedRight.quasis.length &&
        unwrappedLeft.expressions.length === unwrappedRight.expressions.length &&
        unwrappedLeft.quasis.every(
          (quasi, quasiIndex) => quasi.value.raw === unwrappedRight.quasis[quasiIndex]?.value.raw,
        ) &&
        unwrappedLeft.expressions.every((expression, expressionIndex) =>
          compare(expression, unwrappedRight.expressions[expressionIndex]),
        )
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "CallExpression") &&
      isNodeOfType(unwrappedRight, "CallExpression")
    ) {
      return (
        compare(unwrappedLeft.callee, unwrappedRight.callee) &&
        unwrappedLeft.arguments.length === unwrappedRight.arguments.length &&
        unwrappedLeft.arguments.every((argument, argumentIndex) =>
          compare(argument, unwrappedRight.arguments[argumentIndex]),
        )
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "SpreadElement") &&
      isNodeOfType(unwrappedRight, "SpreadElement")
    ) {
      return compare(unwrappedLeft.argument, unwrappedRight.argument);
    }
    if (
      isNodeOfType(unwrappedLeft, "ArrayExpression") &&
      isNodeOfType(unwrappedRight, "ArrayExpression")
    ) {
      return (
        unwrappedLeft.elements.length === unwrappedRight.elements.length &&
        unwrappedLeft.elements.every((element, elementIndex) => {
          const rightElement = unwrappedRight.elements[elementIndex];
          if (!element || !rightElement) return element === rightElement;
          return compare(element, rightElement);
        })
      );
    }
    if (isNodeOfType(unwrappedLeft, "Property") && isNodeOfType(unwrappedRight, "Property")) {
      const leftPropertyName = getStaticPropertyKeyName(unwrappedLeft, {
        stringifyNonStringLiterals: true,
      });
      const keysMatch = unwrappedLeft.computed
        ? unwrappedRight.computed && compare(unwrappedLeft.key, unwrappedRight.key)
        : !unwrappedRight.computed &&
          leftPropertyName !== null &&
          leftPropertyName ===
            getStaticPropertyKeyName(unwrappedRight, { stringifyNonStringLiterals: true });
      return (
        keysMatch &&
        unwrappedLeft.kind === unwrappedRight.kind &&
        unwrappedLeft.method === unwrappedRight.method &&
        unwrappedLeft.shorthand === unwrappedRight.shorthand &&
        compare(unwrappedLeft.value, unwrappedRight.value)
      );
    }
    if (
      isNodeOfType(unwrappedLeft, "ObjectExpression") &&
      isNodeOfType(unwrappedRight, "ObjectExpression")
    ) {
      return (
        unwrappedLeft.properties.length === unwrappedRight.properties.length &&
        unwrappedLeft.properties.every((property, propertyIndex) =>
          compare(property, unwrappedRight.properties[propertyIndex]),
        )
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
  let activeComment: "block" | "line" | null = null;
  let parenthesisDepth = 0;
  const resetSegment = (): void => {
    currentText = "";
    currentTernaryTests = [];
  };

  template.quasis.forEach((quasi, quasiIndex) => {
    const staticText = quasi.value.cooked ?? quasi.value.raw ?? "";
    for (let characterIndex = 0; characterIndex < staticText.length; characterIndex += 1) {
      const character = staticText[characterIndex];
      const nextCharacter = staticText[characterIndex + 1];
      if (activeComment === "block") {
        if (character === "*" && nextCharacter === "/") {
          activeComment = null;
          characterIndex += 1;
        }
        continue;
      }
      if (activeComment === "line") {
        if (character === "\n" || character === "\r") activeComment = null;
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
        activeComment = "block";
        characterIndex += 1;
        continue;
      }
      if (character === "/" && nextCharacter === "/" && currentText.trim().length === 0) {
        activeComment = "line";
        characterIndex += 1;
        continue;
      }
      if (character === '"' || character === "'") {
        activeQuote = character;
        currentText += character;
        continue;
      }
      if (character === "(") {
        parenthesisDepth += 1;
        currentText += character;
      } else if (character === ")") {
        parenthesisDepth = Math.max(0, parenthesisDepth - 1);
        currentText += character;
      } else if (character === "{" && parenthesisDepth === 0) {
        if (braceDepth === 0) {
          finalizeDeclaration(currentText, currentTernaryTests, declarations);
        }
        braceDepth += 1;
        resetSegment();
      } else if (character === "}" && parenthesisDepth === 0) {
        braceDepth = Math.max(0, braceDepth - 1);
        resetSegment();
      } else if (character === ";" && parenthesisDepth === 0) {
        if (braceDepth === 0) finalizeDeclaration(currentText, currentTernaryTests, declarations);
        resetSegment();
      } else {
        currentText += character;
      }
    }
    const expression = template.expressions[quasiIndex];
    if (expression && braceDepth === 0 && !activeQuote && !activeComment) {
      if (currentText.trim().length === 0) {
        resetSegment();
      } else {
        currentText += INTERPOLATION_MARKER;
        const ternaryTest = getTernaryInterpolationTest(expression);
        if (ternaryTest) currentTernaryTests.push(ternaryTest);
      }
    }
  });
  if (braceDepth === 0) finalizeDeclaration(currentText, currentTernaryTests, declarations);
  return declarations;
};

const isProvenCssHelperTag = (tag: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const rootIdentifier = getRootIdentifier(tag);
  if (!rootIdentifier) return false;
  const strippedTag = stripParenExpression(tag);
  const symbol = resolveConstIdentifierAlias(rootIdentifier, scopes);
  if (symbol?.kind === "const" && symbol.initializer && strippedTag === rootIdentifier) {
    return isProvenCssHelperTag(symbol.initializer, scopes);
  }
  if (!symbol || symbol.kind !== "import") return false;
  const importDeclaration = symbol.declarationNode.parent;
  if (
    !importDeclaration ||
    !isNodeOfType(importDeclaration, "ImportDeclaration") ||
    importDeclaration.source.value !== "styled-components"
  ) {
    return false;
  }
  if (isNodeOfType(symbol.declarationNode, "ImportSpecifier")) {
    return getImportedName(symbol.declarationNode) === "css" && rootIdentifier === strippedTag;
  }
  return (
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    isNodeOfType(strippedTag, "MemberExpression") &&
    stripParenExpression(strippedTag.object) === rootIdentifier &&
    getStaticPropertyName(strippedTag) === "css"
  );
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
        !isProvenCssHelperTag(node.tag, context.scopes)
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
        const conditionalOccurrences = occurrences.filter((occurrence) => occurrence.isConditional);
        if (conditionalOccurrences.length < 2) continue;
        const firstTests = conditionalOccurrences[0].ternaryTests;
        const allTestsEqual = conditionalOccurrences.every(
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
