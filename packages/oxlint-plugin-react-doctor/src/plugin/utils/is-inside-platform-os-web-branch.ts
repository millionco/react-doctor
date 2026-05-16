import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isPlatformOsMemberExpression = (node: EsTreeNode | undefined | null): boolean => {
  if (!node || !isNodeOfType(node, "MemberExpression")) return false;
  if (node.computed) return false;
  if (!isNodeOfType(node.object, "Identifier") || node.object.name !== "Platform") return false;
  if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "OS") return false;
  return true;
};

const isWebStringLiteral = (node: EsTreeNode | undefined | null): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && node.value === "web") return true;
  if (isNodeOfType(node, "TemplateLiteral") && node.quasis.length === 1) {
    const cooked = node.quasis[0]?.value?.cooked;
    return cooked === "web";
  }
  return false;
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
    isPlatformOsMemberExpression(testNode.left) && isWebStringLiteral(testNode.right);
  const matchesRight =
    isPlatformOsMemberExpression(testNode.right) && isWebStringLiteral(testNode.left);
  if (!matchesLeft && !matchesRight) return { isWebBranch: false, isNonWebBranch: false };
  return {
    isWebBranch: testNode.operator === "===",
    isNonWebBranch: testNode.operator === "!==",
  };
};

// Walks ancestor links from `node` upward. Returns true when the node
// is reachable only through code paths where `Platform.OS === "web"`
// — that is, it appears inside:
//
//   if (Platform.OS === "web") { …node here… }
//   if (Platform.OS !== "web") { … } else { …node here… }
//   Platform.OS === "web" ? <node here /> : …
//   Platform.OS === "web" && <node here />
//   Platform.OS !== "web" || <node here />   (logical short-circuit web path)
//   switch (Platform.OS) { case "web": …node here… }
//
// Nested intermediate guards (`if (someOtherFlag) { …node here… }`
// inside the web branch) are transparent — the walker continues
// upward until it finds the enclosing Platform.OS check or hits the
// top of the file.
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
    } else if (
      isNodeOfType(parent, "SwitchCase") &&
      isWebStringLiteral(parent.test) &&
      isNodeOfType(parent.parent, "SwitchStatement") &&
      isPlatformOsMemberExpression(parent.parent.discriminant)
    ) {
      // `switch (Platform.OS) { case "web": <node here /> … }` — the
      // SwitchCase node's `test` is the literal `"web"` and its parent
      // SwitchStatement's `discriminant` is `Platform.OS`. We only
      // match when the current child is one of the case's `consequent`
      // statements (not the case's `test` itself). `.some(===)` avoids
      // the array-typing mismatch between `Statement[]` and `EsTreeNode`.
      if (parent.consequent.some((statement) => statement === child)) return true;
    }
    child = parent;
    parent = parent.parent ?? null;
  }

  return false;
};
