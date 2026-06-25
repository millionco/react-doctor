import * as fs from "node:fs";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const buildMessage = (name: string): string =>
  `\`${name}\` crashes at runtime because it isn't defined here.`;

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

const parseGlobalComments = (sourceText: string): Set<string> => {
  const globals = new Set<string>();
  const blockCommentPattern = /\/\*\s*global\s+([^*]+)\*\//g;
  const lineCommentPattern = /\/\/\s*global\s+(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = blockCommentPattern.exec(sourceText)) !== null) {
    const identifiers = match[1].split(",");
    for (const identifier of identifiers) {
      const trimmed = identifier.trim();
      if (trimmed) globals.add(trimmed);
    }
  }

  while ((match = lineCommentPattern.exec(sourceText)) !== null) {
    const identifiers = match[1].split(",");
    for (const identifier of identifiers) {
      const trimmed = identifier.trim();
      if (trimmed) globals.add(trimmed);
    }
  }

  return globals;
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
const sourceTextCache = new Map<string, string>();
const getSourceText = (filename: string | undefined): string | null => {
  if (!filename) return null;
  if (sourceTextCache.has(filename)) {
    return sourceTextCache.get(filename)!;
  }
  try {
    const text = fs.readFileSync(filename, "utf8");
    sourceTextCache.set(filename, text);
    return text;
  } catch {
    sourceTextCache.set(filename, "");
    return null;
  }
};

export const jsxNoUndef = defineRule({
  id: "jsx-no-undef",
  title: "Undefined JSX component",
  severity: "error",
  recommendation:
    "Import the component or fix the typo so React can resolve the JSX identifier at runtime.",
  create: (context) => {
    let commentGlobals: Set<string> | null = null;
    const getCommentGlobals = (): Set<string> => {
      if (commentGlobals) return commentGlobals;
      const settingsSourceText = context.settings?.["jsx-no-undef-source-text"];
      const sourceText =
        typeof settingsSourceText === "string"
          ? settingsSourceText
          : getSourceText(context.filename);
      commentGlobals = sourceText ? parseGlobalComments(sourceText) : new Set();
      return commentGlobals;
    };
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const rootIdentifier = getRootIdentifier(node.name as EsTreeNode);
        if (!rootIdentifier) return;
        if (KNOWN_GLOBALS.has(rootIdentifier)) return;
        const programRoot = findProgramRoot(node);
        if (!programRoot) return;
        const globals = getCommentGlobals();
        if (globals.has(rootIdentifier)) return;
        if (findVariableInitializer(node, rootIdentifier)) return;
        context.report({ node: node.name, message: buildMessage(rootIdentifier) });
      },
    };
  },
});
