import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isClosedObjectKeyMapItem } from "./is-closed-object-key-map-item.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const proveLabel = (source: string): boolean => {
  const filePath = "palette.tsx";
  const { program, errors } = parseFixture(source, { filename: filePath });
  expect(errors).toEqual([]);
  if (!isNodeOfType(program, "Program")) throw new Error("Expected a fixture program");
  attachParentReferences(program);
  const labelExpressions: EsTreeNode[] = [];
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "JSXAttribute") &&
      isNodeOfType(node.name, "JSXIdentifier") &&
      node.name.name === "label" &&
      isNodeOfType(node.value, "JSXExpressionContainer")
    ) {
      labelExpressions.push(node.value.expression);
    }
  });
  expect(labelExpressions).toHaveLength(1);
  const labelExpression = labelExpressions[0];
  if (!labelExpression) throw new Error("Expected a label prop expression");
  return isClosedObjectKeyMapItem(labelExpression, {
    filePath,
    programNode: program,
    scopes: analyzeScopes(program),
  });
};

describe("isClosedObjectKeyMapItem", () => {
  it("proves the mapped prop after a guarded filter and slice of object keys", () => {
    expect(
      proveLabel(`
        function Palette({ swatches }) {
          const labels = swatches && Object.keys(swatches)
            .filter((label) => label.length > 0)
            .slice(1, 8);
          return labels ? (
            <section>{labels.map((label) => {
              const swatch = swatches[label];
              if (!swatch) return null;
              return <ToneBadge key={label} label={label} swatch={swatch} />;
            })}</section>
          ) : null;
        }
      `),
    ).toBe(true);
  });

  it("proves the prop on a direct native Object.keys map", () => {
    expect(
      proveLabel(`
        const badges = Object.keys({ navy: true }).map((label) => <ToneBadge label={label} />);
      `),
    ).toBe(true);
  });

  it.each([
    [
      "an escaped key list",
      `
        const labels = Object.keys(swatches);
        retainForLater(labels);
        const badges = labels.map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "an opaque key transformation",
      `
        const badges = decorate(Object.keys(swatches)).map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "a concatenation that can introduce non-key items",
      `
        const badges = Object.keys(swatches).concat(extras)
          .map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "a replacement Object binding",
      `
        const Object = { keys: () => [customItem] };
        const badges = Object.keys(swatches).map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "a map in the wrong guard branch",
      `
        const labels = swatches && Object.keys(swatches);
        const badges = labels ? null : labels.map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "a filter callback that receives the key array",
      `
        const badges = Object.keys(swatches).filter((label, index, labels) => {
          labels[index + 1] = customItem;
          return true;
        }).map((label) => <ToneBadge label={label} />);
      `,
    ],
    [
      "a reassigned map item",
      `
        const badges = Object.keys(swatches).map((label) => {
          label = customItem;
          return <ToneBadge label={label} />;
        });
      `,
    ],
  ])("does not prove %s", (_name, source) => {
    expect(proveLabel(source)).toBe(false);
  });
});
