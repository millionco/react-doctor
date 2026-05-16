import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Strips TypeScript and optional-chain wrappers that can appear around
// the identifier the user actually wrote. `Platform.OS!` parses as
// `TSNonNullExpression(Platform.OS)`, and `Platform?.OS` parses as
// `ChainExpression(Platform.OS)`. Without this unwrap, the structural
// checks below silently reject perfectly idiomatic code and the rule
// keeps firing on raw text guarded by an optional-chained Platform
// reference (e.g. when `Platform` is imported through a re-export
// whose generated typings make TypeScript demand the `?.`).
const unwrapAccessor = (node: EsTreeNode | undefined | null): EsTreeNode | null => {
  let current: EsTreeNode | undefined | null = node;
  while (current) {
    if (isNodeOfType(current, "TSNonNullExpression")) {
      current = current.expression;
      continue;
    }
    if (isNodeOfType(current, "ChainExpression")) {
      current = current.expression;
      continue;
    }
    if (isNodeOfType(current, "TSAsExpression") || isNodeOfType(current, "TSSatisfiesExpression")) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return null;
};

const isPlatformOsMemberExpression = (node: EsTreeNode | undefined | null): boolean => {
  const unwrapped = unwrapAccessor(node);
  if (!unwrapped || !isNodeOfType(unwrapped, "MemberExpression")) return false;
  if (unwrapped.computed) return false;
  const objectExpression = unwrapAccessor(unwrapped.object);
  if (!objectExpression || !isNodeOfType(objectExpression, "Identifier")) return false;
  if (objectExpression.name !== "Platform") return false;
  if (!isNodeOfType(unwrapped.property, "Identifier") || unwrapped.property.name !== "OS") {
    return false;
  }
  return true;
};

const isPlatformSelectCallee = (callee: EsTreeNode | undefined | null): boolean => {
  const unwrapped = unwrapAccessor(callee);
  if (!unwrapped || !isNodeOfType(unwrapped, "MemberExpression")) return false;
  if (unwrapped.computed) return false;
  const objectExpression = unwrapAccessor(unwrapped.object);
  if (!objectExpression || !isNodeOfType(objectExpression, "Identifier")) return false;
  if (objectExpression.name !== "Platform") return false;
  if (!isNodeOfType(unwrapped.property, "Identifier") || unwrapped.property.name !== "select") {
    return false;
  }
  return true;
};

const isStringLiteralEqualTo = (node: EsTreeNode | undefined | null, expected: string): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && node.value === expected) return true;
  if (isNodeOfType(node, "TemplateLiteral") && node.quasis.length === 1) {
    return node.quasis[0]?.value?.cooked === expected;
  }
  return false;
};

// Reads the literal key of an object-property entry whether it was
// written as a bare identifier (`{ web: … }`), a string (`{ "web": … }`)
// or a single-quasi template (`{ [\`web\`]: … }` — uncommon but legal).
// Returns `null` for keys we can't statically resolve (numeric computed
// keys, identifier references, etc.); the caller treats `null` as "not
// the web key".
const readStaticPropertyKeyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (property.computed) {
    if (isStringLiteralEqualTo(property.key, "web")) return "web";
    return null;
  }
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

interface PlatformOsTestClassification {
  isWebBranch: boolean;
  isNonWebBranch: boolean;
}

// Classifies a binary-expression test against `Platform.OS`:
//
//   Platform.OS === "web" / "web" === Platform.OS  → consequent ≡ web
//   Platform.OS !== "web" / "web" !== Platform.OS  → alternate  ≡ web
//
// Anything else (e.g. `Platform.OS === "ios"`, `Platform.OS === variable`)
// leaves both fields `false`. We deliberately avoid trying to enumerate
// the negative form (`Platform.OS !== "ios" && Platform.OS !== "android"`)
// — it's a strict-equality check, and `=== "web"` is the canonical RN
// idiom users reach for.
const classifyPlatformOsBinaryTest = (
  testNode: EsTreeNode | undefined | null,
): PlatformOsTestClassification => {
  if (!testNode || !isNodeOfType(testNode, "BinaryExpression")) {
    return { isWebBranch: false, isNonWebBranch: false };
  }
  if (testNode.operator !== "===" && testNode.operator !== "!==") {
    return { isWebBranch: false, isNonWebBranch: false };
  }
  const matchesLeft =
    isPlatformOsMemberExpression(testNode.left) && isStringLiteralEqualTo(testNode.right, "web");
  const matchesRight =
    isPlatformOsMemberExpression(testNode.right) && isStringLiteralEqualTo(testNode.left, "web");
  if (!matchesLeft && !matchesRight) return { isWebBranch: false, isNonWebBranch: false };
  return {
    isWebBranch: testNode.operator === "===",
    isNonWebBranch: testNode.operator === "!==",
  };
};

// True when crossing the boundary between `parent` and `child` exits a
// scope where any enclosing `Platform.OS` guard would have applied.
// Without this stop, JSX defined inside a callback hoisted out of a
// `Platform.OS === "web"` branch would inherit the parent's guard even
// when the callback is handed to a sibling that runs on every platform
// — a false negative directly analogous to a nested auth helper
// "protecting" a sibling server action.
const isScopeBoundaryNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "Program");

// Walks ancestor links from `node` upward. Returns true when the node
// is reachable only through code paths where `Platform.OS === "web"`
// — that is, it appears inside:
//
//   if (Platform.OS === "web") { …node here… }
//   if (Platform.OS !== "web") { … } else { …node here… }
//   Platform.OS === "web" ? <node here /> : …
//   Platform.OS === "web" && <node here />
//   Platform.OS !== "web" || <node here />   (logical short-circuit web path)
//   switch (Platform.OS) { case "web": …node here… break; }
//   Platform.select({ web: <node here />, default: … })
//
// The mirror form (`"web" === Platform.OS`), optional chaining
// (`Platform?.OS`), and the TS non-null assertion (`Platform.OS!`) are
// recognised too. Negative checks like `Platform.OS === "ios"` are
// deliberately NOT considered an exemption — only the explicit web
// branch is.
//
// Nested intermediate guards (`if (someOtherFlag) { …node here… }`
// inside the web branch) are transparent — the walker keeps moving
// upward through unrelated control structures until it either finds
// the enclosing Platform.OS check or crosses a function / `Program`
// boundary. The boundary stop is what keeps JSX defined inside a
// callback hoisted out of a `Platform.OS` branch from inheriting the
// parent guard when the callback is handed to a sibling that runs on
// every platform.
export const isInsidePlatformOsWebBranch = (node: EsTreeNode): boolean => {
  let child: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;

  while (parent) {
    if (isNodeOfType(parent, "IfStatement")) {
      const classification = classifyPlatformOsBinaryTest(parent.test);
      if (classification.isWebBranch && parent.consequent === child) return true;
      if (classification.isNonWebBranch && parent.alternate === child) return true;
    } else if (isNodeOfType(parent, "ConditionalExpression")) {
      const classification = classifyPlatformOsBinaryTest(parent.test);
      if (classification.isWebBranch && parent.consequent === child) return true;
      if (classification.isNonWebBranch && parent.alternate === child) return true;
    } else if (isNodeOfType(parent, "LogicalExpression")) {
      const classification = classifyPlatformOsBinaryTest(parent.left);
      // `Platform.OS === "web" && <…/>` — the right-hand side only
      // evaluates when the left was truthy, so we treat it as a
      // web-only branch. The mirror `Platform.OS !== "web" || <…/>`
      // applies for the `||` operator: the right side runs only when
      // the platform IS web.
      if (parent.right === child) {
        if (parent.operator === "&&" && classification.isWebBranch) return true;
        if (parent.operator === "||" && classification.isNonWebBranch) return true;
      }
    } else if (isNodeOfType(parent, "SwitchCase")) {
      // `switch (Platform.OS) { case "web": …node here… }` — the case's
      // `test` is the `"web"` literal, and its parent SwitchStatement's
      // discriminant is `Platform.OS`. Anything reachable from the case
      // body (not the `test` expression itself) is web-only — modulo
      // fall-through, which we conservatively don't try to follow:
      // JSX inside the next case body is still reported because that
      // case's `test` is not `"web"`.
      const switchStatement = parent.parent;
      if (
        isNodeOfType(switchStatement, "SwitchStatement") &&
        isPlatformOsMemberExpression(switchStatement.discriminant) &&
        isStringLiteralEqualTo(parent.test, "web") &&
        parent.test !== child
      ) {
        return true;
      }
    } else if (isNodeOfType(parent, "Property")) {
      // `Platform.select({ web: <node here />, default: … })` — the
      // canonical RN platform-fork helper. The JSXElement is the value
      // of a property whose key is `"web"`, inside the ObjectExpression
      // that is the first argument to `Platform.select(...)`.
      const objectExpression = parent.parent;
      if (isNodeOfType(objectExpression, "ObjectExpression")) {
        const callExpression = objectExpression.parent;
        if (
          isNodeOfType(callExpression, "CallExpression") &&
          callExpression.arguments[0] === objectExpression &&
          isPlatformSelectCallee(callExpression.callee) &&
          readStaticPropertyKeyName(parent) === "web" &&
          parent.value === child
        ) {
          return true;
        }
      }
    }

    if (isScopeBoundaryNode(parent)) return false;

    child = parent;
    parent = parent.parent ?? null;
  }

  return false;
};
