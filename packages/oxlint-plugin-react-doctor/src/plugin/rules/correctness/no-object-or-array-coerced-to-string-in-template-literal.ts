import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingDeclarator } from "../../utils/find-enclosing-declarator.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

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
  if (property.computed) return isSymbolToPrimitiveKey(key);
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

const isHookCallee = (callee: EsTreeNode, hookName: string): boolean => {
  if (isNodeOfType(callee, "Identifier")) return callee.name === hookName;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === hookName
  );
};

const firstArgumentLiteralKind = (call: EsTreeNodeOfType<"CallExpression">): LiteralKind | null => {
  const firstArgument = call.arguments[0];
  if (!firstArgument) return null;
  return objectOrArrayKind(stripParenExpression(firstArgument as EsTreeNode));
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
const resolveInterpolatedLiteralKind = (identifier: EsTreeNode): LiteralKind | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return null;

  const declarator = findEnclosingDeclarator(binding.bindingIdentifier);
  if (!declarator || !isConstDeclarator(declarator)) return null;
  const init = declarator.init ? stripParenExpression(declarator.init as EsTreeNode) : null;
  if (!init) return null;

  if (declarator.id === binding.bindingIdentifier) {
    const directKind = objectOrArrayKind(init);
    if (directKind) return directKind;
    if (isNodeOfType(init, "CallExpression") && isHookCallee(init.callee as EsTreeNode, "useRef")) {
      return firstArgumentLiteralKind(init);
    }
    return null;
  }

  const id = declarator.id as EsTreeNode;
  if (
    isNodeOfType(id, "ArrayPattern") &&
    id.elements[0] === binding.bindingIdentifier &&
    isNodeOfType(init, "CallExpression") &&
    isHookCallee(init.callee as EsTreeNode, "useState")
  ) {
    return firstArgumentLiteralKind(init);
  }
  return null;
};

const messageFor = (kind: LiteralKind): string =>
  kind === "object"
    ? "Interpolating this object runs its default `toString()`, which produces `[object Object]` and hides the real value — read a specific property or wrap it in `JSON.stringify`."
    : "Interpolating this array runs its default `toString()`, which comma-joins the values into unreadable output — read a specific element or use `.join`/`JSON.stringify`.";

const isStringConcatSibling = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "Literal") && typeof node.value === "string") ||
  isNodeOfType(node, "TemplateLiteral");

export const noObjectOrArrayCoercedToStringInTemplateLiteral = defineRule({
  id: "no-object-or-array-coerced-to-string-in-template-literal",
  title: "Object or array coerced to string in a template literal",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Interpolating an object/array runs its default `toString()` (`[object Object]` / comma-joined garbage); read a specific property/element or wrap the value in `JSON.stringify`.",
  create: (context: RuleContext) => {
    const reportIfCoercedLiteral = (expression: EsTreeNode): void => {
      const strippedExpression = stripParenExpression(expression);
      const kind =
        objectOrArrayKind(strippedExpression) ?? resolveInterpolatedLiteralKind(strippedExpression);
      if (!kind) return;
      context.report({ node: expression, message: messageFor(kind) });
    };
    return {
      TemplateLiteral(node: EsTreeNodeOfType<"TemplateLiteral">) {
        const parent = node.parent;
        if (parent && isNodeOfType(parent, "TaggedTemplateExpression")) return;
        for (const expression of node.expressions) {
          reportIfCoercedLiteral(expression as EsTreeNode);
        }
      },
      BinaryExpression(node: EsTreeNodeOfType<"BinaryExpression">) {
        if (node.operator !== "+") return;
        const left = node.left as EsTreeNode;
        const right = node.right as EsTreeNode;
        if (isNodeOfType(left, "Identifier") && isStringConcatSibling(right)) {
          reportIfCoercedLiteral(left);
        }
        if (isNodeOfType(right, "Identifier") && isStringConcatSibling(left)) {
          reportIfCoercedLiteral(right);
        }
      },
    };
  },
});
