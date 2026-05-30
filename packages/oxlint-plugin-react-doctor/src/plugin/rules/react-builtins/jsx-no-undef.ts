import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (name: string): string => `\`${name}\` is not defined in this scope.`;

const KNOWN_GLOBALS = new Set([
  "globalThis",
  "window",
  "document",
  "console",
  "React",
  "self",
  // `this` in JSX member-expression position resolves at runtime to
  // the enclosing component instance / context — not a binding the
  // rule needs to verify (e.g. `<this.props.tag />`).
  "this",
]);

const getRootIdentifier = (elementName: EsTreeNode): string | null => {
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const firstCharacter = elementName.name.charCodeAt(0);
    const isLowercase = firstCharacter >= 97 && firstCharacter <= 122;
    if (isLowercase) return null; // intrinsic HTML element
    return elementName.name;
  }
  if (isNodeOfType(elementName, "JSXMemberExpression")) {
    let current: EsTreeNode = elementName;
    while (isNodeOfType(current, "JSXMemberExpression")) {
      current = current.object;
    }
    if (isNodeOfType(current, "JSXIdentifier")) return current.name;
  }
  return null;
};

// Port of `oxc_linter::rules::react::jsx_no_undef`. Reports JSX usages
// of an identifier (or root of a member expression) that has no
// binding visible from the JSX site.
//
// Scope-aware via `findVariableInitializer`:
//
//   - Block-scoped `let` / `const` declarations are only visible in
//     their owning block — JSX in a sibling block flags as undefined.
//   - Function-scoped `var` and function/class declarations bind to
//     the enclosing function-or-program scope (JS hoisting).
//   - Imports bind to the module scope and are visible everywhere.
//   - TS declarations that have runtime representation (`enum`,
//     `namespace`, `import X = require(...)`) DO suppress the
//     diagnostic. `interface` and `type` alias declarations do NOT
//     — those are erased at runtime and JSX usage of them is an
//     error we want to surface.
export const jsxNoUndef = defineRule<Rule>({
  id: "jsx-no-undef",
  severity: "error",
  recommendation: "Import the component or check for typos.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const rootIdentifier = getRootIdentifier(node.name as EsTreeNode);
      if (!rootIdentifier) return;
      if (KNOWN_GLOBALS.has(rootIdentifier)) return;
      const programRoot = findProgramRoot(node);
      if (!programRoot) return;
      // Scope-aware lookup first — finds bindings whose scope owner is
      // an ancestor of the JSX site (respects let/const block scoping
      // AND TS declarations like enum / type / interface / module).
      if (findVariableInitializer(node, rootIdentifier)) return;
      context.report({ node: node.name, message: buildMessage(rootIdentifier) });
    },
  }),
});
