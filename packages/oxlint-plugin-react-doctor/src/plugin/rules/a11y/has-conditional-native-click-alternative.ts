import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { getTailwindVisibilityEffect } from "../../utils/get-tailwind-visibility-effect.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxAttributePotentiallyTruthy } from "../../utils/is-jsx-attribute-potentially-truthy.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { someAst } from "../../utils/some-ast.js";

const CONTAINER_ATTRIBUTES = new Set(["className", "onClick"]);
const BUTTON_ATTRIBUTES = new Set(["aria-label", "className", "onClick", "title", "type"]);
const ORDINARY_CLASS_VARIANTS = new Set(["dark", "focus", "focus-visible", "hover"]);
const HIDING_UTILITIES = new Set(["opacity-0", "scale-0", "size-0", "sr-only"]);
const ORDINARY_BUTTON_UTILITIES =
  /^(?:absolute|relative|flex|inline-flex|block|h-[1-9][0-9]*|w-[1-9][0-9]*|left-[0-9]+|top-[0-9]+|z-[0-9]+|items-center|justify-center|rounded-full|border|shadow(?:-sm)?|(?:bg|border|text)-[a-z]+(?:-[0-9]+)?(?:\/[0-9]+)?)$/;

const ACTIVATION_INTERFERENCE_ATTRIBUTES = new Set([
  "dangerouslysetinnerhtml",
  "inert",
  "onclickcapture",
  "onkeydown",
  "onkeydowncapture",
  "onkeypress",
  "onkeypresscapture",
  "onkeyup",
  "onkeyupcapture",
]);
const FIELDSET_INTERFERENCE_ATTRIBUTES = new Set([
  ...ACTIVATION_INTERFERENCE_ATTRIBUTES,
  "disabled",
]);
const hasInterferenceByProgram = new WeakMap<EsTreeNodeOfType<"Program">, boolean>();

const hasSourceLocalInterference = (node: EsTreeNode): boolean => {
  const program = findProgramRoot(node);
  if (!program) return true;
  const cached = hasInterferenceByProgram.get(program);
  if (cached !== undefined) return cached;

  // A same-file stylesheet or wrapper can block the native button even if
  // the returned element has a valid local action.
  const hasInterference = someAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "JSXOpeningElement")) return false;
    const name = getJsxAttributeName(candidate.name);
    if (name === "style" || name === "link") return true;
    const watched =
      name === "fieldset" ? FIELDSET_INTERFERENCE_ATTRIBUTES : ACTIVATION_INTERFERENCE_ATTRIBUTES;
    for (const attribute of candidate.attributes) {
      if (!isNodeOfType(attribute, "JSXAttribute")) continue;
      const name = getJsxAttributeName(attribute.name)?.toLowerCase();
      if (name !== undefined && watched.has(name) && isJsxAttributePotentiallyTruthy(attribute))
        return true;
    }
    for (const name of watched) {
      if (hasJsxSpreadThatMayProvideAttribute(candidate.attributes, name)) return true;
    }
    return false;
  });
  hasInterferenceByProgram.set(program, hasInterference);
  return hasInterference;
};

const getExactAttributes = (
  element: EsTreeNodeOfType<"JSXOpeningElement">,
  allowedNames: ReadonlySet<string>,
): Map<string, EsTreeNodeOfType<"JSXAttribute">> | null => {
  const attributes = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
  for (const attribute of element.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return null;
    const name = getJsxAttributeName(attribute.name);
    if (!name || !allowedNames.has(name) || attributes.has(name)) return null;
    attributes.set(name, attribute);
  }
  return attributes;
};

const getAttributeExpression = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined,
): EsTreeNode | null => {
  const value = attribute?.value;
  if (!value) return null;
  return isNodeOfType(value, "JSXExpressionContainer")
    ? stripParenExpression(value.expression)
    : value;
};

const hasOnlyVisibleClasses = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined,
  isButton: boolean,
): boolean => {
  if (!attribute) return true;
  const expression = getAttributeExpression(attribute);
  if (!expression) return false;
  const staticClassName = getStaticStringExpression(expression);
  let classNames = staticClassName === null ? [] : [staticClassName];
  if (isNodeOfType(expression, "TemplateLiteral") && staticClassName === null) {
    if (expression.expressions.length > 2) return false;
    classNames = [""];
    for (const [index, quasi] of expression.quasis.entries()) {
      const cooked = quasi.value.cooked;
      if (typeof cooked !== "string") return false;
      classNames = classNames.map((className) => className + cooked);
      const interpolation = expression.expressions[index];
      if (!interpolation) continue;
      const choice = stripParenExpression(interpolation);
      if (!isNodeOfType(choice, "ConditionalExpression")) return false;
      const consequent = getStaticStringExpression(choice.consequent);
      const alternate = getStaticStringExpression(choice.alternate);
      if (consequent === null || alternate === null) return false;
      classNames = classNames.flatMap((className) => [
        className + consequent,
        className + alternate,
      ]);
    }
  }
  return (
    classNames.length > 0 &&
    classNames.every((className) =>
      splitTailwindClassName(className).every((rawToken) => {
        const { isImportant, utility, variants } = parseTailwindClassNameToken(rawToken);
        if (
          isImportant ||
          !variants.every((variant) => ORDINARY_CLASS_VARIANTS.has(variant)) ||
          !/^[a-z][a-z0-9/-]*$/.test(utility)
        ) {
          return false;
        }
        const visibility = getTailwindVisibilityEffect(utility);
        return (
          visibility.isVisible !== false &&
          visibility.status !== "unknown" &&
          !HIDING_UTILITIES.has(utility) &&
          (!isButton || ORDINARY_BUTTON_UTILITIES.test(utility))
        );
      }),
    )
  );
};

const isNullClickBranch = (branch: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const expression = stripParenExpression(branch);
  return (
    (isNodeOfType(expression, "Literal") && expression.value === null) ||
    (isNodeOfType(expression, "Identifier") &&
      expression.name === "undefined" &&
      scopes.isGlobalReference(expression))
  );
};

const isEventIndependentDispatch = (handler: EsTreeNode | null, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(handler, "ArrowFunctionExpression") || handler.async) return false;
  const [event] = handler.params;
  if (handler.params.length !== 1 || !isNodeOfType(event, "Identifier")) return false;
  if (!isNodeOfType(handler.body, "BlockStatement") || handler.body.body.length !== 2) {
    return false;
  }
  const [blocker, dispatch] = handler.body.body;
  if (
    !isNodeOfType(blocker, "ExpressionStatement") ||
    !isNodeOfType(dispatch, "ExpressionStatement")
  ) {
    return false;
  }
  const stop = stripParenExpression(blocker.expression);
  const call = stripParenExpression(dispatch.expression);
  const eventSymbol = scopes.symbolFor(event);
  if (
    !eventSymbol ||
    eventSymbol.references.length !== 1 ||
    !isNodeOfType(stop, "CallExpression") ||
    stop.optional ||
    stop.arguments.length !== 0 ||
    !isNodeOfType(stop.callee, "MemberExpression") ||
    stop.callee.optional ||
    getStaticPropertyName(stop.callee) !== "stopPropagation" ||
    !isNodeOfType(stop.callee.object, "Identifier") ||
    scopes.symbolFor(stop.callee.object) !== eventSymbol ||
    !isNodeOfType(call, "CallExpression") ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.callee.name === "eval"
  ) {
    return false;
  }
  const callback = scopes.symbolFor(call.callee);
  if (!callback || callback.kind !== "parameter" || !isSymbolReadOnly(callback)) return false;
  return call.arguments.every((argument) => {
    const expression = stripParenExpression(argument);
    const value =
      isNodeOfType(expression, "UnaryExpression") && expression.operator === "!"
        ? stripParenExpression(expression.argument)
        : expression;
    if (isNodeOfType(value, "Literal")) {
      return value.value === null || ["boolean", "number", "string"].includes(typeof value.value);
    }
    if (!isNodeOfType(value, "Identifier")) return false;
    const symbol = scopes.symbolFor(value);
    return Boolean(symbol?.kind === "parameter" && isSymbolReadOnly(symbol));
  });
};

const getGatedButton = (
  child: EsTreeNode,
  gate: SymbolDescriptor,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"JSXElement"> | null => {
  if (!isNodeOfType(child, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(child.expression);
  let test: EsTreeNode;
  let shown: EsTreeNode;
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
    test = expression.left;
    shown = expression.right;
  } else if (
    isNodeOfType(expression, "ConditionalExpression") &&
    isNullClickBranch(expression.alternate, scopes)
  ) {
    test = expression.test;
    shown = expression.consequent;
  } else {
    return null;
  }
  test = stripParenExpression(test);
  shown = stripParenExpression(shown);
  if (!isNodeOfType(test, "Identifier") || scopes.symbolFor(test) !== gate) return null;
  return isNodeOfType(shown, "JSXElement") ? shown : null;
};

export const hasConditionalNativeClickAlternative = (
  container: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(container.name, "JSXIdentifier") || container.name.name !== "div") return false;
  const element = container.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const returnExpression = findTransparentExpressionRoot(element);
  const owner = findEnclosingFunction(element);
  // Reject intervening host/capture/disabled fieldset contexts and prop evaluation
  // after the click gate. The two identifier reads must occur without arbitrary work.
  if (
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(returnExpression.parent, "ReturnStatement")
  ) {
    return false;
  }
  for (
    let scope: ScopeDescriptor | null = scopes.scopeFor(container);
    scope;
    scope = scope.parent
  ) {
    if (scope.kind === "with") return false;
  }
  const containerAttributes = getExactAttributes(container, CONTAINER_ATTRIBUTES);
  if (!containerAttributes) return false;
  const clickAttribute = containerAttributes.get("onClick");
  if (!clickAttribute || container.attributes.at(-1) !== clickAttribute) return false;
  const click = getAttributeExpression(clickAttribute);
  if (
    !isNodeOfType(click, "ConditionalExpression") ||
    !isNullClickBranch(click.alternate, scopes)
  ) {
    return false;
  }
  const gateExpression = stripParenExpression(click.test);
  const handlerExpression = stripParenExpression(click.consequent);
  if (
    !isNodeOfType(gateExpression, "Identifier") ||
    !isNodeOfType(handlerExpression, "Identifier")
  ) {
    return false;
  }
  const gate = scopes.symbolFor(gateExpression);
  const handler = scopes.symbolFor(handlerExpression);
  if (
    !gate ||
    (gate.kind !== "const" && gate.kind !== "parameter") ||
    !isSymbolReadOnly(gate) ||
    !handler ||
    handler.kind !== "const" ||
    !handler.initializer ||
    !isNodeOfType(handler.declarationNode, "VariableDeclarator") ||
    handler.declarationNode.id !== handler.bindingIdentifier ||
    findEnclosingFunction(handler.initializer) !== owner ||
    !isEventIndependentDispatch(stripParenExpression(handler.initializer), scopes)
  ) {
    return false;
  }

  const firstChild = element.children.find(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim().length > 0,
  );
  if (!firstChild) return false;
  const button = getGatedButton(firstChild, gate, scopes);
  if (!button) return false;
  const opening = button.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier") || opening.name.name !== "button") return false;
  const buttonAttributes = getExactAttributes(opening, BUTTON_ATTRIBUTES);
  if (!buttonAttributes) return false;
  const clickExpression = getAttributeExpression(buttonAttributes.get("onClick"));
  return (
    isNodeOfType(clickExpression, "Identifier") &&
    scopes.symbolFor(clickExpression) === handler &&
    getStaticStringExpression(getAttributeExpression(buttonAttributes.get("type"))) === "button" &&
    hasOnlyVisibleClasses(containerAttributes.get("className"), false) &&
    hasOnlyVisibleClasses(buttonAttributes.get("className"), true) &&
    !hasSourceLocalInterference(container)
  );
};
