import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingDeclarator } from "../../utils/find-enclosing-declarator.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenReactHookCall } from "../../utils/is-proven-effect-hook-call.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

type LiteralKind = "object" | "array";

const STRING_COERCION_METHOD_NAMES = new Set(["toString", "valueOf"]);

const isSymbolToPrimitiveKey = (key: EsTreeNode): boolean =>
  isNodeOfType(key, "MemberExpression") &&
  !key.computed &&
  isNodeOfType(key.object, "Identifier") &&
  key.object.name === "Symbol" &&
  isNodeOfType(key.property, "Identifier") &&
  key.property.name === "toPrimitive";

// A spread or a custom `toString` / `valueOf` / `[Symbol.toPrimitive]`
// means interpolation may produce a meaningful string, not
// `[object Object]` — the diagnostic's claim would be false.
const propertyMayCustomizeStringCoercion = (property: EsTreeNode): boolean => {
  if (isNodeOfType(property, "SpreadElement")) return true;
  if (!isNodeOfType(property, "Property")) return false;
  const key = property.key as EsTreeNode;
  if (property.computed) {
    return (
      isSymbolToPrimitiveKey(key) ||
      (isNodeOfType(key, "Literal") &&
        typeof key.value === "string" &&
        STRING_COERCION_METHOD_NAMES.has(key.value))
    );
  }
  if (isNodeOfType(key, "Identifier")) return STRING_COERCION_METHOD_NAMES.has(key.name);
  return (
    isNodeOfType(key, "Literal") &&
    typeof key.value === "string" &&
    STRING_COERCION_METHOD_NAMES.has(key.value)
  );
};

const objectOrArrayKind = (node: EsTreeNode): LiteralKind | null => {
  if (isNodeOfType(node, "ObjectExpression")) {
    const mayCustomizeCoercion = node.properties.some((property) =>
      propertyMayCustomizeStringCoercion(property as EsTreeNode),
    );
    return mayCustomizeCoercion ? null : "object";
  }
  if (isNodeOfType(node, "ArrayExpression")) return "array";
  return null;
};

const USE_REF_HOOK_NAMES = new Set(["useRef"]);
const USE_STATE_HOOK_NAMES = new Set(["useState"]);

const firstArgumentLiteral = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
  const firstArgument = call.arguments[0];
  if (!firstArgument) return null;
  const literal = stripParenExpression(firstArgument as EsTreeNode);
  return objectOrArrayKind(literal) ? literal : null;
};

const isConstDeclarator = (declarator: EsTreeNodeOfType<"VariableDeclarator">): boolean => {
  const declaration = declarator.parent;
  return Boolean(
    declaration && isNodeOfType(declaration, "VariableDeclaration") && declaration.kind === "const",
  );
};

// Resolves an interpolated identifier to the object/array literal it is
// provably bound to: a direct `const x = {…}/[…]`, a `useRef({…})` whose
// ref object is interpolated bare, or the state of a
// `const [x] = useState({…})`. Returns null for anything not provably a
// literal in scope (imports, params, reassigned/unknown values) —
// `var`/`let` bindings are skipped because a later reassignment (e.g.
// `lines = lines.join("\n")`) can replace the literal with a string.
const resolveInterpolatedLiteral = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return null;

  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || !isConstDeclarator(declarator)) return null;
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  if (!init) return null;

  if (declarator.id === binding.bindingIdentifier) {
    if (objectOrArrayKind(init)) return init;
    if (
      isNodeOfType(init, "CallExpression") &&
      isProvenReactHookCall(init, USE_REF_HOOK_NAMES, scopes)
    ) {
      return firstArgumentLiteral(init);
    }
    return null;
  }

  const id = declarator.id as EsTreeNode;
  if (
    isNodeOfType(id, "ArrayPattern") &&
    id.elements[0] === binding.bindingIdentifier &&
    isNodeOfType(init, "CallExpression") &&
    isProvenReactHookCall(init, USE_STATE_HOOK_NAMES, scopes)
  ) {
    return firstArgumentLiteral(init);
  }
  return null;
};

const resolveInterpolatedLiteralKind = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): LiteralKind | null => {
  const literal = resolveInterpolatedLiteral(identifier, scopes);
  return literal ? objectOrArrayKind(literal) : null;
};

const isStaticallyLossyArrayLiteral = (
  array: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): boolean =>
  array.elements.some((element) => {
    if (!element) return false;
    if (isNodeOfType(element, "SpreadElement")) {
      const spreadArgument = stripParenExpression(element.argument);
      const resolvedSpread = isNodeOfType(spreadArgument, "ArrayExpression")
        ? spreadArgument
        : resolveInterpolatedLiteral(spreadArgument, scopes);
      return Boolean(
        resolvedSpread &&
        isNodeOfType(resolvedSpread, "ArrayExpression") &&
        isStaticallyLossyArrayLiteral(resolvedSpread, scopes),
      );
    }
    const expression = stripParenExpression(element);
    if (isNodeOfType(expression, "ArrayExpression")) return true;
    if (objectOrArrayKind(expression) === "object") return true;
    const resolved = resolveInterpolatedLiteral(expression, scopes);
    return Boolean(
      resolved &&
      (isNodeOfType(resolved, "ArrayExpression") || objectOrArrayKind(resolved) === "object"),
    );
  });

const messageFor = (kind: LiteralKind): string =>
  kind === "object"
    ? "Interpolating this object runs its default `toString()`, which produces `[object Object]` and hides the real value — read a specific property or wrap it in `JSON.stringify`."
    : "Interpolating this array runs its default `toString()`, which comma-joins the values into unreadable output — read a specific element or use `.join`/`JSON.stringify`.";

const INTENTIONAL_ARRAY_JOIN_FUNCTION_NAMES = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "matrix",
  "matrix3d",
]);

const isIntentionalArrayJoinInterpolation = (precedingText: string): boolean => {
  const functionName = precedingText.match(/([a-zA-Z][\w-]*)\(\s*$/)?.[1];
  return Boolean(functionName && INTENTIONAL_ARRAY_JOIN_FUNCTION_NAMES.has(functionName));
};

export const noObjectOrArrayCoercedToStringInTemplateLiteral = defineRule({
  id: "no-object-or-array-coerced-to-string-in-template-literal",
  title: "Object or lossy array coerced in a template literal",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Interpolating an object or structurally nested array can produce `[object Object]` or lose structure; read a specific value or use `.join`/`JSON.stringify`.",
  create: (context: RuleContext) => {
    const skipTestlikeFile = isTestlikeFilename(context.filename);
    const isKnownAdditionOperand = (expression: EsTreeNode): boolean => {
      const inner = stripParenExpression(expression);
      return (
        isNodeOfType(inner, "Literal") ||
        isNodeOfType(inner, "TemplateLiteral") ||
        objectOrArrayKind(inner) !== null ||
        resolveInterpolatedLiteralKind(inner, context.scopes) !== null
      );
    };
    const reportIfCoercedLiteral = (expression: EsTreeNode): void => {
      const strippedExpression = stripParenExpression(expression);
      const resolvedLiteral =
        objectOrArrayKind(strippedExpression) !== null
          ? strippedExpression
          : resolveInterpolatedLiteral(strippedExpression, context.scopes);
      const kind = resolvedLiteral ? objectOrArrayKind(resolvedLiteral) : null;
      if (!kind) return;
      if (
        kind === "array" &&
        (!isNodeOfType(resolvedLiteral, "ArrayExpression") ||
          !isStaticallyLossyArrayLiteral(resolvedLiteral, context.scopes))
      ) {
        return;
      }
      context.report({ node: expression, message: messageFor(kind) });
    };
    return {
      TemplateLiteral(node: EsTreeNodeOfType<"TemplateLiteral">) {
        if (skipTestlikeFile) return;
        const parent = node.parent;
        if (parent && isNodeOfType(parent, "TaggedTemplateExpression")) return;
        node.expressions.forEach((expression, expressionIndex) => {
          // `rgb(${channels})` / `matrix(${values})` — the interpolation
          // sits inside functional syntax whose separator IS the comma, so
          // an array's comma-join is the intended output.
          const precedingText = node.quasis[expressionIndex]?.value.cooked ?? "";
          if (isIntentionalArrayJoinInterpolation(precedingText)) return;
          reportIfCoercedLiteral(expression as EsTreeNode);
        });
      },
      BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
        if (skipTestlikeFile) return;
        if (node.operator !== "+") return;
        const left = node.left as EsTreeNode;
        const right = node.right as EsTreeNode;
        if (isKnownAdditionOperand(right)) reportIfCoercedLiteral(left);
        if (isKnownAdditionOperand(left)) reportIfCoercedLiteral(right);
      },
    };
  },
});
