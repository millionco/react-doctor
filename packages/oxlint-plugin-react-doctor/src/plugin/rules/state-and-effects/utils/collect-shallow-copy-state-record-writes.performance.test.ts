import { describe, expect, it } from "vite-plus/test";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../../semantic/control-flow-graph.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { buildNumericSelectionFixture } from "../../../../test-utils/build-numeric-selection-fixture.js";
import {
  BASE_TYPE_READ_BUDGET,
  CONTEXT_SELECTION_LIST_COUNT,
  LARGE_SELECTION_LIST_COUNT,
  SMALL_SELECTION_LIST_COUNT,
  TYPE_READ_BUDGET_PER_LIST,
} from "../../../../test-utils/numeric-selection-work/constants.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import { collectShallowCopyStateRecordWrites } from "./collect-shallow-copy-state-record-writes.js";

const parseProgram = (code: string): EsTreeNode => {
  const result = parseFixture(code);
  expect(result.errors).toEqual([]);
  attachParentReferences(result.program);
  return result.program;
};

const selectBindings = (
  program: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<UseStateBinding> => {
  if (!isNodeOfType(program, "Program")) throw new Error("Expected Program");
  const declaration = program.body.find((node) => isNodeOfType(node, "ExportNamedDeclaration"));
  if (
    !isNodeOfType(declaration, "ExportNamedDeclaration") ||
    !isNodeOfType(declaration.declaration, "VariableDeclaration")
  )
    throw new Error("Expected component declaration");
  const component = declaration.declaration.declarations[0]?.init;
  if (
    !isNodeOfType(component, "ArrowFunctionExpression") ||
    !isNodeOfType(component.body, "BlockStatement")
  )
    throw new Error("Expected component body");
  return collectUseStateBindings(component.body, context.scopes);
};

const createContext = (program: EsTreeNode): RuleContext => ({
  scopes: analyzeScopes(program),
  cfg: analyzeControlFlow(program),
  filename: "synthetic-selection-work.tsx",
  report: () => {},
});

describe("numeric state selection construction work", () => {
  for (const hasOpaqueFeed of [false, true]) {
    for (const count of [SMALL_SELECTION_LIST_COUNT, LARGE_SELECTION_LIST_COUNT]) {
      it(`bounds first construction for ${count} lists; opaque=${hasOpaqueFeed}`, () => {
        const program = parseProgram(buildNumericSelectionFixture(count, hasOpaqueFeed));
        const context = createContext(program);
        const binding = selectBindings(program, context)[0];
        if (!binding) throw new Error("Expected retained record binding");
        const descriptors = new Map<EsTreeNode, PropertyDescriptor>();
        let typeReads = 0;
        walkAst(program, (node) => {
          const descriptor = Object.getOwnPropertyDescriptor(node, "type");
          if (descriptor) descriptors.set(node, descriptor);
        });
        for (const [node, descriptor] of descriptors) {
          Object.defineProperty(node, "type", {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            get: () => {
              typeReads++;
              return descriptor.value;
            },
          });
        }
        let writes: ReadonlyArray<EsTreeNode>;
        try {
          writes = collectShallowCopyStateRecordWrites(binding, context);
        } finally {
          for (const [node, descriptor] of descriptors)
            Object.defineProperty(node, "type", descriptor);
        }
        expect(writes).toHaveLength(hasOpaqueFeed ? 0 : count);
        expect(typeReads).toBeLessThan(BASE_TYPE_READ_BUDGET + count * TYPE_READ_BUDGET_PER_LIST);
      });
    }
  }

  it.each([
    [false, true],
    [true, false],
  ])(
    "keeps selected bindings fresh across analysis order %s/%s",
    (reverseAnalyses, reverseBindings) => {
      const code = buildNumericSelectionFixture(CONTEXT_SELECTION_LIST_COUNT, false).replace(
        " const add=",
        ' const poison = () => setChosen1(["opaque"]);\n const add=',
      );
      const program = parseProgram(code);
      const contexts = [createContext(program), createContext(program)];
      expect(contexts[0]?.scopes).not.toBe(contexts[1]?.scopes);
      if (reverseAnalyses) contexts.reverse();
      for (const context of contexts) {
        const bindings = selectBindings(program, context);
        const selections = [bindings[0], bindings[CONTEXT_SELECTION_LIST_COUNT]];
        if (reverseBindings) selections.reverse();
        for (const binding of [...selections, ...selections.toReversed()]) {
          if (!binding) throw new Error("Expected selected binding");
          const expected = binding === bindings[0] ? 1 : 0;
          expect(collectShallowCopyStateRecordWrites(binding, context)).toHaveLength(expected);
        }
      }
    },
  );
});
