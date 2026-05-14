import { RENDER_PROP_PROLIFERATION_THRESHOLD } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const RENDER_PROP_PATTERN = /^render[A-Z]/;

// HACK: render-prop proliferation (`<Foo renderHeader={…} renderFooter={…}
// renderActions={…} />`) is the smell — a single render-prop is often
// the legitimate library API (MUI Autocomplete's `renderInput`, FlatList's
// `renderItem`, react-hook-form's Controller `render`, etc.) and we
// shouldn't fire on those. Instead we flag the COMPOUND case: when a
// single element receives 3 or more `render*` props, that's the smell
// of "many slots cobbled together where compound components or
// `children` would be cleaner".
export const noRenderPropChildren = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Replace `renderXxx` props with compound subcomponents (e.g. `<Modal.Header>`) or `children` so the parent doesn't dictate every customization point",
  examples: [
    {
      before:
        "<Modal\n  renderHeader={() => <h1>Title</h1>}\n  renderBody={() => <p>Body</p>}\n  renderFooter={() => <button>Close</button>}\n/>",
      after:
        "<Modal>\n  <Modal.Header>Title</Modal.Header>\n  <Modal.Body>Body</Modal.Body>\n  <Modal.Footer><button>Close</button></Modal.Footer>\n</Modal>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const renderPropAttrs: Array<{ name: string; node: EsTreeNode }> = [];
      for (const attr of node.attributes ?? []) {
        if (!isNodeOfType(attr, "JSXAttribute")) continue;
        if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
        const name = attr.name.name;
        if (!RENDER_PROP_PATTERN.test(name)) continue;
        renderPropAttrs.push({ name, node: attr });
      }
      if (renderPropAttrs.length < RENDER_PROP_PROLIFERATION_THRESHOLD) return;

      const propList = renderPropAttrs
        .slice(0, 3)
        .map((entry) => entry.name)
        .join(", ");
      context.report({
        node: renderPropAttrs[0].node,
        message: `${renderPropAttrs.length} render-prop slots on the same element (${propList}…) — collapse into compound subcomponents or \`children\` so consumers don't need to know about every customization point`,
      });
    },
  }),
});
