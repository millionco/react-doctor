import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getIconLibraryFamily } from "../../utils/get-icon-library-family.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";

export const noMixedIconLibraries = defineRule({
  id: "no-mixed-icon-libraries",
  title: "File mixes visual icon families",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Use one icon family within a component so stroke, fill, and proportions agree.",
  create: (context: RuleContext) => {
    const families = new Set<string>();
    let programNode: EsTreeNodeOfType<"Program"> | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programNode = node;
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (isTypeOnlyImport(node) || node.specifiers.length === 0) return;
        const source = node.source.value;
        if (typeof source !== "string") return;
        const family = getIconLibraryFamily(source);
        if (family) families.add(family);
      },
      "Program:exit"() {
        if (!programNode || families.size < 2) return;
        context.report({
          node: programNode,
          message: `This file combines ${[...families].join(", ")}. Keep one icon family so the interface has consistent visual weight and proportions.`,
        });
      },
    };
  },
});
