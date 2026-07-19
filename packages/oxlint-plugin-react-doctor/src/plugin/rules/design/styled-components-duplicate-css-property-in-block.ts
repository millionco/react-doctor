import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
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
import { walkAst } from "../../utils/walk-ast.js";

// Opaque marker substituted for each `${...}` interpolation while scanning
// the CSS text, so an interpolation never contributes a `;`/`{`/`}`/`:`
// separator of its own.
const INTERPOLATION_MARKER = "\u0000";
const CSS_PROPERTY_PATTERN = /^-?[a-z][a-z-]*$/;

interface CssDeclaration {
  readonly property: string;
  readonly isConditional: boolean;
  readonly isImportant: boolean;
  readonly ternaryTests: TernaryTest[];
}

interface TernaryTest {
  readonly expression: EsTreeNode;
  readonly parameterBindings: ReadonlyMap<string, CallbackParameterBinding>;
  readonly localBindingNames: ReadonlySet<string>;
  readonly localInitializers: ReadonlyMap<string, EsTreeNode>;
  readonly alwaysProducesCssValue: boolean;
}

interface CallbackParameterBinding {
  readonly sourcePath: CallbackParameterSourcePath;
  readonly defaultValues: readonly EsTreeNode[];
}

interface CallbackParameterSourcePath {
  readonly parameterIndex: number;
  readonly segments: readonly CallbackParameterSourceSegment[];
}

interface CallbackParameterSourceSegment {
  readonly propertyName: string | null;
  readonly arrayRestOffset: number | null;
  readonly excludedPropertyNames: readonly string[] | null;
}

const propertySourceSegment = (propertyName: string): CallbackParameterSourceSegment => ({
  propertyName,
  arrayRestOffset: null,
  excludedPropertyNames: null,
});

const arrayRestSourceSegment = (arrayRestOffset: number): CallbackParameterSourceSegment => ({
  propertyName: null,
  arrayRestOffset,
  excludedPropertyNames: null,
});

const restSourceSegment = (
  excludedPropertyNames: readonly string[],
): CallbackParameterSourceSegment => ({
  propertyName: null,
  arrayRestOffset: null,
  excludedPropertyNames,
});

const collectCallbackParameterBindings = (
  parameter: EsTreeNode,
  sourcePath: CallbackParameterSourcePath,
  defaultValues: readonly EsTreeNode[],
  bindings: Map<string, CallbackParameterBinding>,
): void => {
  if (isNodeOfType(parameter, "Identifier")) {
    bindings.set(parameter.name, { sourcePath, defaultValues });
    return;
  }
  if (isNodeOfType(parameter, "AssignmentPattern")) {
    const nestedDefaultValues =
      sourcePath.segments.length === 0 ? defaultValues : [...defaultValues, parameter.right];
    collectCallbackParameterBindings(parameter.left, sourcePath, nestedDefaultValues, bindings);
    return;
  }
  if (isNodeOfType(parameter, "RestElement")) {
    const restPath =
      sourcePath.segments.length === 0
        ? { ...sourcePath, segments: [arrayRestSourceSegment(0)] }
        : sourcePath;
    collectCallbackParameterBindings(parameter.argument, restPath, defaultValues, bindings);
    return;
  }
  if (isNodeOfType(parameter, "ObjectPattern")) {
    const propertyNames: string[] = [];
    let hasDynamicProperty = false;
    for (const property of parameter.properties) {
      if (!isNodeOfType(property, "Property")) continue;
      const propertyName = getStaticPropertyKeyName(property, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      if (propertyName === null) {
        hasDynamicProperty = true;
        continue;
      }
      propertyNames.push(propertyName);
      collectCallbackParameterBindings(
        property.value,
        { ...sourcePath, segments: [...sourcePath.segments, propertySourceSegment(propertyName)] },
        defaultValues,
        bindings,
      );
    }
    if (hasDynamicProperty) return;
    const uniquePropertyNames = [...new Set(propertyNames)].toSorted();
    const restPath: CallbackParameterSourcePath = {
      ...sourcePath,
      segments: [...sourcePath.segments, restSourceSegment(uniquePropertyNames)],
    };
    for (const property of parameter.properties) {
      if (isNodeOfType(property, "RestElement")) {
        collectCallbackParameterBindings(property.argument, restPath, defaultValues, bindings);
      }
    }
    return;
  }
  if (isNodeOfType(parameter, "ArrayPattern")) {
    for (let elementIndex = 0; elementIndex < parameter.elements.length; elementIndex += 1) {
      const element = parameter.elements[elementIndex];
      if (!element) continue;
      if (isNodeOfType(element, "RestElement")) {
        collectCallbackParameterBindings(
          element.argument,
          {
            ...sourcePath,
            segments: [...sourcePath.segments, arrayRestSourceSegment(elementIndex)],
          },
          defaultValues,
          bindings,
        );
        continue;
      }
      collectCallbackParameterBindings(
        element,
        {
          ...sourcePath,
          segments: [...sourcePath.segments, propertySourceSegment(String(elementIndex))],
        },
        defaultValues,
        bindings,
      );
    }
  }
};

const getCallbackParameterBindings = (
  parameters: readonly EsTreeNode[],
): Map<string, CallbackParameterBinding> => {
  const bindings = new Map<string, CallbackParameterBinding>();
  parameters.forEach((parameter, parameterIndex) => {
    collectCallbackParameterBindings(parameter, { parameterIndex, segments: [] }, [], bindings);
  });
  return bindings;
};

const EMPTY_BINDINGS = new Map<string, CallbackParameterBinding>();
const EMPTY_NAMES = new Set<string>();
const EMPTY_INITIALIZERS = new Map<string, EsTreeNode>();

const isFlattenedInterpolationValue = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Literal")) {
    return unwrapped.value === null || unwrapped.value === false || unwrapped.value === "";
  }
  if (isNodeOfType(unwrapped, "Identifier")) return unwrapped.name === "undefined";
  return isNodeOfType(unwrapped, "UnaryExpression") && unwrapped.operator === "void";
};

const doesConditionalAlwaysProduceCssValue = (
  conditionalExpression: EsTreeNodeOfType<"ConditionalExpression">,
): boolean =>
  [conditionalExpression.consequent, conditionalExpression.alternate].every((branch) => {
    const unwrappedBranch = stripParenExpression(branch);
    return isNodeOfType(unwrappedBranch, "ConditionalExpression")
      ? doesConditionalAlwaysProduceCssValue(unwrappedBranch)
      : !isFlattenedInterpolationValue(unwrappedBranch);
  });

const getTernaryInterpolationTest = (expression: EsTreeNode | undefined): TernaryTest | null => {
  if (!expression) return null;
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return {
      expression: stripped.test,
      parameterBindings: EMPTY_BINDINGS,
      localBindingNames: EMPTY_NAMES,
      localInitializers: EMPTY_INITIALIZERS,
      alwaysProducesCssValue: doesConditionalAlwaysProduceCssValue(stripped),
    };
  }
  if (
    isNodeOfType(stripped, "ArrowFunctionExpression") ||
    isNodeOfType(stripped, "FunctionExpression")
  ) {
    const parameters = stripped.params;
    const parameterBindings = getCallbackParameterBindings(parameters);
    const localBindingNames = new Set<string>();
    for (const parameter of parameters) collectPatternNames(parameter, localBindingNames);
    const localInitializers = new Map<string, EsTreeNode>();
    const body = stripParenExpression(stripped.body);
    if (isNodeOfType(body, "ConditionalExpression")) {
      return {
        expression: body.test,
        parameterBindings,
        localBindingNames,
        localInitializers,
        alwaysProducesCssValue: doesConditionalAlwaysProduceCssValue(body),
      };
    }
    if (isNodeOfType(body, "BlockStatement")) {
      for (const statement of body.body) {
        if (isNodeOfType(statement, "VariableDeclaration")) {
          for (const declarator of statement.declarations) {
            collectPatternNames(declarator.id, localBindingNames);
            if (statement.kind === "const" && declarator.init) {
              const initializerBinding = getParameterBinding(declarator.init, {
                expression: declarator.init,
                parameterBindings,
                localBindingNames,
                localInitializers,
                alwaysProducesCssValue: true,
              });
              if (initializerBinding) {
                collectCallbackParameterBindings(
                  declarator.id,
                  initializerBinding.sourcePath,
                  initializerBinding.defaultValues,
                  parameterBindings,
                );
              }
            }
            if (
              statement.kind === "const" &&
              isNodeOfType(declarator.id, "Identifier") &&
              declarator.init
            ) {
              localInitializers.set(declarator.id.name, declarator.init);
            }
          }
          continue;
        }
        if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) continue;
        const returnedExpression = stripParenExpression(statement.argument);
        if (isNodeOfType(returnedExpression, "ConditionalExpression")) {
          return {
            expression: returnedExpression.test,
            parameterBindings,
            localBindingNames,
            localInitializers,
            alwaysProducesCssValue: doesConditionalAlwaysProduceCssValue(returnedExpression),
          };
        }
      }
    }
  }
  return null;
};

const getParameterBinding = (
  node: EsTreeNode,
  test: TernaryTest,
  resolvingLocalNames = new Set<string>(),
): CallbackParameterBinding | null => {
  const unwrapped = stripParenExpression(node);
  if (isNodeOfType(unwrapped, "Identifier")) {
    const parameterBinding = test.parameterBindings.get(unwrapped.name);
    if (parameterBinding) return parameterBinding;
    const initializer = test.localInitializers.get(unwrapped.name);
    if (!initializer || resolvingLocalNames.has(unwrapped.name)) return null;
    resolvingLocalNames.add(unwrapped.name);
    const initializerBinding = getParameterBinding(initializer, test, resolvingLocalNames);
    resolvingLocalNames.delete(unwrapped.name);
    return initializerBinding;
  }
  if (!isNodeOfType(unwrapped, "MemberExpression")) return null;
  const objectBinding = getParameterBinding(unwrapped.object, test, resolvingLocalNames);
  if (objectBinding === null) return null;
  const propertyName = getStaticPropertyKeyName(unwrapped, {
    allowComputedString: true,
    stringifyNonStringLiterals: true,
  });
  if (propertyName === null) return null;
  const lastSegment = objectBinding.sourcePath.segments.at(-1);
  const numericPropertyIndex = Number(propertyName);
  const canResolveArrayRestIndex =
    lastSegment !== undefined &&
    lastSegment.arrayRestOffset !== null &&
    /^(?:0|[1-9]\d*)$/.test(propertyName) &&
    Number.isSafeInteger(numericPropertyIndex) &&
    numericPropertyIndex >= 0;
  const isRootParameterRest =
    canResolveArrayRestIndex && objectBinding.sourcePath.segments.length === 1;
  const baseSegments = canResolveArrayRestIndex
    ? objectBinding.sourcePath.segments.slice(0, -1)
    : objectBinding.sourcePath.segments;
  const resolvedPropertyName = canResolveArrayRestIndex
    ? String((lastSegment?.arrayRestOffset ?? 0) + numericPropertyIndex)
    : propertyName;
  return {
    ...objectBinding,
    sourcePath: {
      ...objectBinding.sourcePath,
      parameterIndex: isRootParameterRest
        ? objectBinding.sourcePath.parameterIndex +
          (lastSegment?.arrayRestOffset ?? 0) +
          numericPropertyIndex
        : objectBinding.sourcePath.parameterIndex,
      segments: isRootParameterRest
        ? baseSegments
        : [...baseSegments, propertySourceSegment(resolvedPropertyName)],
    },
  };
};

const areSourceSegmentsEquivalent = (
  left: CallbackParameterSourceSegment,
  right: CallbackParameterSourceSegment,
): boolean =>
  left.propertyName === right.propertyName &&
  left.arrayRestOffset === right.arrayRestOffset &&
  (left.excludedPropertyNames === null || right.excludedPropertyNames === null
    ? left.excludedPropertyNames === right.excludedPropertyNames
    : left.excludedPropertyNames.length === right.excludedPropertyNames.length &&
      left.excludedPropertyNames.every(
        (propertyName, propertyIndex) =>
          propertyName === right.excludedPropertyNames?.[propertyIndex],
      ));

const areSourcePathsEquivalent = (
  left: CallbackParameterSourcePath,
  right: CallbackParameterSourcePath,
): boolean =>
  left.parameterIndex === right.parameterIndex &&
  left.segments.length === right.segments.length &&
  left.segments.every((segment, segmentIndex) =>
    areSourceSegmentsEquivalent(segment, right.segments[segmentIndex]),
  );

const isObviouslyStatefulCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  const rootIdentifier = getRootIdentifier(callee);
  if (!rootIdentifier) return false;
  const symbol = resolveConstIdentifierAlias(rootIdentifier, scopes);
  const symbolInitializer = symbol?.initializer ? stripParenExpression(symbol.initializer) : null;
  let initializer = symbolInitializer;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(symbolInitializer, "ObjectExpression")
  ) {
    const propertyName = getStaticPropertyKeyName(callee, {
      allowComputedString: true,
      stringifyNonStringLiterals: true,
    });
    const property = symbolInitializer.properties.find(
      (candidate) =>
        propertyName !== null &&
        isNodeOfType(candidate, "Property") &&
        getStaticPropertyKeyName(candidate, {
          allowComputedString: true,
          stringifyNonStringLiterals: true,
        }) === propertyName,
    );
    initializer = property && isNodeOfType(property, "Property") ? property.value : null;
  }
  if (
    !initializer ||
    (!isNodeOfType(initializer, "ArrowFunctionExpression") &&
      !isNodeOfType(initializer, "FunctionExpression") &&
      !isNodeOfType(initializer, "FunctionDeclaration"))
  ) {
    return false;
  }
  let isStateful = false;
  walkAst(initializer.body, (node: EsTreeNode) => {
    if (isNodeOfType(node, "AssignmentExpression") || isNodeOfType(node, "UpdateExpression")) {
      isStateful = true;
      return false;
    }
    return true;
  });
  return isStateful;
};

const areTestsEquivalent = (
  left: TernaryTest,
  right: TernaryTest,
  scopes: ScopeAnalysis,
): boolean => {
  const resolvingLeftLocalNames = new Set<string>();
  const resolvingRightLocalNames = new Set<string>();
  const compare = (leftNode: EsTreeNode, rightNode: EsTreeNode): boolean => {
    const unwrappedLeft = stripParenExpression(leftNode);
    const unwrappedRight = stripParenExpression(rightNode);
    if (isNodeOfType(unwrappedLeft, "Identifier")) {
      const leftInitializer = left.localInitializers.get(unwrappedLeft.name);
      if (leftInitializer && !left.parameterBindings.has(unwrappedLeft.name)) {
        if (resolvingLeftLocalNames.has(unwrappedLeft.name)) return false;
        resolvingLeftLocalNames.add(unwrappedLeft.name);
        const areEquivalent = compare(leftInitializer, unwrappedRight);
        resolvingLeftLocalNames.delete(unwrappedLeft.name);
        return areEquivalent;
      }
    }
    if (isNodeOfType(unwrappedRight, "Identifier")) {
      const rightInitializer = right.localInitializers.get(unwrappedRight.name);
      if (rightInitializer && !right.parameterBindings.has(unwrappedRight.name)) {
        if (resolvingRightLocalNames.has(unwrappedRight.name)) return false;
        resolvingRightLocalNames.add(unwrappedRight.name);
        const areEquivalent = compare(unwrappedLeft, rightInitializer);
        resolvingRightLocalNames.delete(unwrappedRight.name);
        return areEquivalent;
      }
    }
    const leftParameterBinding = getParameterBinding(unwrappedLeft, left);
    const rightParameterBinding = getParameterBinding(unwrappedRight, right);
    if (leftParameterBinding !== null || rightParameterBinding !== null) {
      return (
        leftParameterBinding !== null &&
        rightParameterBinding !== null &&
        areSourcePathsEquivalent(
          leftParameterBinding.sourcePath,
          rightParameterBinding.sourcePath,
        ) &&
        leftParameterBinding.defaultValues.length === rightParameterBinding.defaultValues.length &&
        leftParameterBinding.defaultValues.every((defaultValue, defaultValueIndex) =>
          compare(defaultValue, rightParameterBinding.defaultValues[defaultValueIndex]),
        )
      );
    }
    if (isNodeOfType(unwrappedLeft, "Identifier") && isNodeOfType(unwrappedRight, "Identifier")) {
      if (
        left.localBindingNames.has(unwrappedLeft.name) ||
        right.localBindingNames.has(unwrappedRight.name)
      ) {
        return false;
      }
    }
    if (unwrappedLeft.type !== unwrappedRight.type) return false;
    if (isNodeOfType(unwrappedLeft, "Identifier") && isNodeOfType(unwrappedRight, "Identifier")) {
      return unwrappedLeft.name === unwrappedRight.name;
    }
    if (isNodeOfType(unwrappedLeft, "Literal") && isNodeOfType(unwrappedRight, "Literal")) {
      if ("regex" in unwrappedLeft || "regex" in unwrappedRight) {
        return (
          "regex" in unwrappedLeft &&
          "regex" in unwrappedRight &&
          unwrappedLeft.regex.pattern === unwrappedRight.regex.pattern &&
          unwrappedLeft.regex.flags === unwrappedRight.regex.flags
        );
      }
      return unwrappedLeft.value === unwrappedRight.value;
    }
    if (isNodeOfType(unwrappedLeft, "ThisExpression")) return true;
    if (
      isNodeOfType(unwrappedLeft, "MemberExpression") &&
      isNodeOfType(unwrappedRight, "MemberExpression")
    ) {
      const leftPropertyName = getStaticPropertyKeyName(unwrappedLeft, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      const rightPropertyName = getStaticPropertyKeyName(unwrappedRight, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      return (
        compare(unwrappedLeft.object, unwrappedRight.object) &&
        (leftPropertyName !== null || rightPropertyName !== null
          ? leftPropertyName !== null && leftPropertyName === rightPropertyName
          : unwrappedLeft.computed === unwrappedRight.computed &&
            compare(unwrappedLeft.property, unwrappedRight.property))
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
          (quasi, quasiIndex) =>
            (quasi.value.cooked ?? quasi.value.raw) ===
            (unwrappedRight.quasis[quasiIndex]?.value.cooked ??
              unwrappedRight.quasis[quasiIndex]?.value.raw),
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
      if (
        isObviouslyStatefulCall(unwrappedLeft, scopes) ||
        isObviouslyStatefulCall(unwrappedRight, scopes) ||
        (unwrappedLeft.arguments.length === 0 &&
          unwrappedRight.arguments.length === 0 &&
          getParameterBinding(unwrappedLeft.callee, left) === null &&
          getParameterBinding(unwrappedRight.callee, right) === null)
      ) {
        return false;
      }
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
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      const rightPropertyName = getStaticPropertyKeyName(unwrappedRight, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      const keysMatch =
        leftPropertyName !== null || rightPropertyName !== null
          ? leftPropertyName !== null && leftPropertyName === rightPropertyName
          : unwrappedLeft.computed &&
            unwrappedRight.computed &&
            compare(unwrappedLeft.key, unwrappedRight.key);
      return (
        keysMatch &&
        unwrappedLeft.kind === unwrappedRight.kind &&
        unwrappedLeft.method === unwrappedRight.method &&
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
  declarations.push({
    property,
    isConditional: ternaryTests.length > 0,
    isImportant: /!\s*important\s*$/i.test(text),
    ternaryTests,
  });
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
    if (expression && braceDepth === 0 && !activeComment) {
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
              areTestsEquivalent(test, firstTests[testIndex], context.scopes),
            ),
        );
        if (allTestsEqual) continue;
        const hasConflictingOverride = occurrences.some((laterOccurrence, laterIndex) => {
          if (
            !laterOccurrence.isConditional ||
            !laterOccurrence.ternaryTests.every((test) => test.alwaysProducesCssValue)
          ) {
            return false;
          }
          for (let priorIndex = laterIndex - 1; priorIndex >= 0; priorIndex -= 1) {
            const priorOccurrence = occurrences[priorIndex];
            const priorAlwaysProducesCssValue =
              !priorOccurrence.isConditional ||
              priorOccurrence.ternaryTests.every((test) => test.alwaysProducesCssValue);
            if (!priorAlwaysProducesCssValue) continue;
            if (!laterOccurrence.isImportant && priorOccurrence.isImportant) {
              return false;
            }
            if (!priorOccurrence.isConditional) return false;
            const hasDifferentTests =
              priorOccurrence.ternaryTests.length !== laterOccurrence.ternaryTests.length ||
              laterOccurrence.ternaryTests.some(
                (test, testIndex) =>
                  !areTestsEquivalent(
                    test,
                    priorOccurrence.ternaryTests[testIndex],
                    context.scopes,
                  ),
              );
            if (hasDifferentTests) return true;
            continue;
          }
          return false;
        });
        if (!hasConflictingOverride) continue;
        context.report({
          node,
          message: `The CSS property \`${property}\` is declared ${occurrences.length} times at the same level here, so a later conditional value can override an earlier one — merge them into a single declaration to make the precedence explicit.`,
        });
      }
    },
  }),
});
