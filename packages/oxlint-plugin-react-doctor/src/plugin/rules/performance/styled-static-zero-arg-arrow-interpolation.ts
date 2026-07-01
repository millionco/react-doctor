import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const STYLED_TAG_ROOT_NAMES = new Set(["styled", "css", "keyframes", "createGlobalStyle"]);
const STYLED_SOURCE_PATTERN = /styled|emotion/i;

// Peels `styled.div`, `styled(Component)`, `styled.div.attrs({})`, `css`,
// etc. down to the leading identifier so we can confirm it is the
// styled-components/emotion API and not a same-named local.
const tagRootIdentifier = (tag: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let current: EsTreeNode = tag;
  for (;;) {
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

const isStyledTag = (tag: EsTreeNode): boolean => {
  const root = tagRootIdentifier(tag);
  if (!root || !STYLED_TAG_ROOT_NAMES.has(root.name)) return false;
  const importSource = getImportSourceForName(root, root.name);
  return importSource !== null && STYLED_SOURCE_PATTERN.test(importSource);
};

// Identifier references that are not member-property names or object
// keys — i.e. the actual value references the arrow body reads.
const collectReferenceIdentifiers = (body: EsTreeNode): EsTreeNodeOfType<"Identifier">[] => {
  const references: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(body, (child) => {
    if (!isNodeOfType(child, "Identifier")) return;
    const parent = child.parent;
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === child &&
      !parent.computed
    ) {
      return;
    }
    if (parent && isNodeOfType(parent, "Property") && parent.key === child && !parent.computed) {
      return;
    }
    references.push(child);
  });
  return references;
};

// A body is "static" when it references only literals/template-literals
// and import-bound (or unresolved/global) bindings — never a same-file
// module const/let, which is the lazy/TDZ/circular-import deferral idiom
// that must NOT be inlined.
const isStaticInlinableBody = (arrow: EsTreeNodeOfType<"ArrowFunctionExpression">): boolean => {
  let containsCall = false;
  walkAst(arrow.body, (child) => {
    if (isNodeOfType(child, "CallExpression") || isNodeOfType(child, "NewExpression")) {
      containsCall = true;
      return false;
    }
  });
  if (containsCall) return false;

  for (const reference of collectReferenceIdentifiers(arrow.body)) {
    // Import-bound references are safe to inline (the value is available
    // at module-init time in the styled block regardless).
    if (getImportSourceForName(reference, reference.name) !== null) continue;
    // A same-file variable declaration is the deferral case — keep quiet.
    if (findVariableInitializer(reference, reference.name) !== null) return false;
  }
  return true;
};

// styled-components re-executes every `${() => …}` interpolation on each
// render to build the style string. A zero-parameter arrow whose body is
// fully static always returns the same string, so the function wrapper
// only forces re-execution (and, for `css` blocks, re-injection) — it
// should be inlined.
export const styledStaticZeroArgArrowInterpolation = defineRule({
  id: "styled-static-zero-arg-arrow-interpolation",
  title: "Static zero-arg arrow in styled interpolation",
  severity: "warn",
  category: "Performance",
  requires: ["styled-components"],
  recommendation:
    "Inline the static value instead of wrapping it in a `() => …` arrow so styled-components does not re-run and re-inject it on every render.",
  create: (context: RuleContext) => ({
    TaggedTemplateExpression(node: EsTreeNodeOfType<"TaggedTemplateExpression">) {
      if (!isStyledTag(node.tag)) return;
      for (const expression of node.quasi.expressions ?? []) {
        if (!isNodeOfType(expression, "ArrowFunctionExpression")) continue;
        if ((expression.params?.length ?? 0) !== 0) continue;
        if (!isStaticInlinableBody(expression)) continue;
        context.report({
          node: expression,
          message:
            "styled-components re-runs this `() => …` interpolation on every render even though its value never changes — inline the static value so it is computed once.",
        });
      }
    },
  }),
});
