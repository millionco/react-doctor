import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { attachSourceLocations } from "../../../test-utils/attach-source-locations.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  KEYED_RECORD_PROOF_AST_READS_PER_CODE_UNIT,
  KEYED_RECORD_PROOF_COUNTS,
  KEYED_RECORD_PROOF_CONTEXT_COMPONENT_COUNT,
  KEYED_RECORD_PROOF_DISTINCT_SHAPE,
  KEYED_RECORD_PROOF_KEY_ATTRIBUTE,
  KEYED_RECORD_PROOF_MAX_PROGRAM_BODY_READS,
  KEYED_RECORD_PROOF_PREACT_DIRECTIVE,
  KEYED_RECORD_PROOF_PREACT_SETTINGS,
  KEYED_RECORD_PROOF_PROVIDER_READS_PER_ENTRY,
  KEYED_RECORD_PROOF_READ_PADDING,
  KEYED_RECORD_PROOF_REACT_DIRECTIVE,
  KEYED_RECORD_PROOF_REFERENCE_READS_PER_ENTRY,
  KEYED_RECORD_PROOF_ROOT_READS_PER_ENTRY,
  KEYED_RECORD_PROOF_SETTINGS,
  KEYED_RECORD_PROOF_SHARED_SHAPE,
  KEYED_RECORD_PROOF_SOURCE,
} from "../../../test-utils/keyed-record-proof/constants.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import type { ControlFlowAnalysis } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { BaseRuleSourceCode, RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";
import { KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN } from "./utils/constants.js";
import { hasKeyedImmutableRecordReset } from "./utils/has-keyed-immutable-record-reset.js";

interface KeyedEffectSelection {
  component: EsTreeNode;
  effect: EsTreeNodeOfType<"CallExpression">;
}

interface KeyedProofFixture {
  program: EsTreeNodeOfType<"Program">;
  scopes: ScopeAnalysis;
  cfg: ControlFlowAnalysis;
  nodes: EsTreeNode[];
  symbols: Set<SymbolDescriptor>;
  selections: KeyedEffectSelection[];
  parentComponent: EsTreeNode;
}

const buildKeyedProofCode = (shape: string, count: number): string => {
  const [imports, selectedInterface, parentSource, ...childLines] =
    KEYED_RECORD_PROOF_SOURCE.split("\n");
  if (!imports || !selectedInterface || !parentSource) throw new Error("Incomplete fixture source");
  const prefix = `${imports}\n${selectedInterface}\n`;
  const childSource = childLines.join("\n");
  if (shape === KEYED_RECORD_PROOF_DISTINCT_SHAPE) {
    return (
      prefix +
      Array.from({ length: count }, (_, componentIndex) =>
        `${parentSource}\n${childSource}`
          .replaceAll("PrivateCard", `PrivateCard${componentIndex}`)
          .replaceAll("Parent", `Parent${componentIndex}`),
      ).join("")
    );
  }
  return (
    prefix +
    Array.from(
      { length: count },
      (_, componentIndex) => `${parentSource.replaceAll("Parent", `Parent${componentIndex}`)}\n`,
    ).join("") +
    childSource
  );
};

const prepareKeyedProof = (code: string): KeyedProofFixture => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected fixture Program");
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, code);
  const scopes = analyzeScopes(parsed.program);
  const cfg = analyzeControlFlow(parsed.program);
  const nodes: EsTreeNode[] = [];
  const symbols = new Set(scopes.rootScope.symbols);
  const selections: KeyedEffectSelection[] = [];
  let parentComponent: EsTreeNode | undefined;
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const symbol = scopes.symbolFor(node);
      if (symbol) symbols.add(symbol);
    }
    if (
      isNodeOfType(node, "ArrowFunctionExpression") &&
      isNodeOfType(node.parent, "VariableDeclarator") &&
      isNodeOfType(node.parent.id, "Identifier") &&
      node.parent.id.name.startsWith("Parent")
    ) {
      parentComponent ??= node;
    }
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "Identifier") ||
      node.callee.name !== "useEffect"
    )
      return;
    const component = findEnclosingFunction(node);
    if (!component) throw new Error("Expected effect owner");
    selections.push({ component, effect: node });
  });
  if (!parentComponent) throw new Error("Expected parent component");
  return { program: parsed.program, scopes, cfg, nodes, symbols, selections, parentComponent };
};

const workCases = [KEYED_RECORD_PROOF_DISTINCT_SHAPE, KEYED_RECORD_PROOF_SHARED_SHAPE].flatMap(
  (shape) => KEYED_RECORD_PROOF_COUNTS.map((count) => ({ shape, count })),
);

describe("keyed immutable record proof construction", () => {
  it.each(workCases)("bounds cold work for $shape with $count entries", ({ shape, count }) => {
    const code = buildKeyedProofCode(shape, count);
    const fixture = prepareKeyedProof(code);
    const counters = {
      ast: 0,
      references: 0,
      providerReferences: 0,
      rootSymbols: 0,
      programBody: 0,
      sourceReads: 0,
    };
    for (const symbol of fixture.symbols) {
      Object.defineProperty(symbol, "references", {
        configurable: true,
        value: new Proxy(symbol.references, {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) {
              counters.references += 1;
              if (symbol.name === "useEffect" || symbol.name === "useState")
                counters.providerReferences += 1;
            }
            return Reflect.get(target, property, receiver);
          },
        }),
      });
    }
    Object.defineProperty(fixture.scopes.rootScope, "symbols", {
      configurable: true,
      value: new Proxy(fixture.scopes.rootScope.symbols, {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) counters.rootSymbols += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    for (const node of fixture.nodes) {
      const nodeType = node.type;
      Object.defineProperty(node, "type", {
        configurable: true,
        get: () => {
          counters.ast += 1;
          return nodeType;
        },
      });
    }
    const programBody = fixture.program.body;
    Object.defineProperty(fixture.program, "body", {
      configurable: true,
      get: () => {
        counters.programBody += 1;
        return programBody;
      },
    });
    const sourceCode = {
      ast: fixture.program,
      getText() {
        if (this !== sourceCode) throw new Error("Source method binding lost");
        counters.sourceReads += 1;
        return code;
      },
    };
    const context: RuleContext = {
      scopes: fixture.scopes,
      cfg: fixture.cfg,
      settings: KEYED_RECORD_PROOF_SETTINGS,
      sourceCode,
      report: () => {},
    };
    const regexSpy = vi.spyOn(KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN, "test");
    try {
      for (const selection of fixture.selections)
        expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
          true,
        );
      expect(regexSpy).toHaveBeenCalledTimes(1);
    } finally {
      regexSpy.mockRestore();
    }
    expect(counters.sourceReads).toBe(fixture.selections.length);
    expect(counters.ast).toBeLessThanOrEqual(
      code.length * KEYED_RECORD_PROOF_AST_READS_PER_CODE_UNIT,
    );
    expect(counters.references).toBeLessThanOrEqual(
      count * KEYED_RECORD_PROOF_REFERENCE_READS_PER_ENTRY + KEYED_RECORD_PROOF_READ_PADDING,
    );
    expect(counters.providerReferences).toBeLessThanOrEqual(
      count * KEYED_RECORD_PROOF_PROVIDER_READS_PER_ENTRY + KEYED_RECORD_PROOF_READ_PADDING,
    );
    expect(counters.rootSymbols).toBeLessThanOrEqual(
      count * KEYED_RECORD_PROOF_ROOT_READS_PER_ENTRY + KEYED_RECORD_PROOF_READ_PADDING,
    );
    expect(counters.programBody).toBeLessThanOrEqual(KEYED_RECORD_PROOF_MAX_PROGRAM_BODY_READS);
    const admitted = runRule(noResetAllStateOnPropChange, code, {
      settings: KEYED_RECORD_PROOF_SETTINGS,
    });
    const declined = runRule(
      noResetAllStateOnPropChange,
      code.replaceAll(KEYED_RECORD_PROOF_KEY_ATTRIBUTE, ""),
      { settings: KEYED_RECORD_PROOF_SETTINGS },
    );
    expect(admitted.parseErrors).toEqual([]);
    expect(declined.parseErrors).toEqual([]);
    expect(admitted.diagnostics).toHaveLength(0);
    expect(declined.diagnostics).toHaveLength(
      shape === KEYED_RECORD_PROOF_DISTINCT_SHAPE ? count : 1,
    );
  });

  it.each([false, true])(
    "keeps profile, source and selected owner current, reverse %s",
    (reverse) => {
      const code = buildKeyedProofCode(
        KEYED_RECORD_PROOF_DISTINCT_SHAPE,
        KEYED_RECORD_PROOF_CONTEXT_COMPONENT_COUNT,
      ).replace(KEYED_RECORD_PROOF_KEY_ATTRIBUTE, "");
      const fixture = prepareKeyedProof(code);
      const [declinedSelection, selection] = fixture.selections;
      if (!selection || !declinedSelection) throw new Error("Expected both selected effects");
      const analyses = [fixture.scopes, analyzeScopes(fixture.program)];
      expect(analyses[0]).not.toBe(analyses[1]);
      let currentText = code;
      let shouldThrow = false;
      let currentSettings = KEYED_RECORD_PROOF_SETTINGS;
      const sourceCode = {
        ast: fixture.program,
        getText() {
          if (this !== sourceCode) throw new Error("Source method binding lost");
          if (shouldThrow) throw new Error("Unavailable source");
          return currentText;
        },
      };
      let currentSource: BaseRuleSourceCode | undefined = sourceCode;
      for (const scopes of reverse ? [...analyses].reverse() : analyses) {
        expect(scopes.rootScope.node).toBe(fixture.program);
        const context: RuleContext = {
          scopes,
          cfg: fixture.cfg,
          get settings() {
            return currentSettings;
          },
          get sourceCode() {
            return currentSource;
          },
          report: () => {},
        };
        const variants = reverse
          ? [KEYED_RECORD_PROOF_PREACT_DIRECTIVE, ""]
          : ["", KEYED_RECORD_PROOF_PREACT_DIRECTIVE];
        for (const directive of [...variants, ...variants.toReversed()]) {
          currentSource = sourceCode;
          shouldThrow = false;
          currentSettings = KEYED_RECORD_PROOF_SETTINGS;
          currentText = directive + code;
          expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
            directive === "",
          );
        }
        currentText = code;
        const selections = reverse
          ? [selection, declinedSelection]
          : [declinedSelection, selection];
        for (const currentSelection of [...selections, ...selections.toReversed()]) {
          expect(
            hasKeyedImmutableRecordReset(
              currentSelection.component,
              currentSelection.effect,
              context,
            ),
          ).toBe(currentSelection === selection);
        }
        currentSettings = KEYED_RECORD_PROOF_PREACT_SETTINGS;
        expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
          false,
        );
        currentSettings = KEYED_RECORD_PROOF_SETTINGS;
        currentSource = undefined;
        expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
          false,
        );
        currentSource = sourceCode;
        shouldThrow = true;
        expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
          false,
        );
        shouldThrow = false;
        expect(
          hasKeyedImmutableRecordReset(fixture.parentComponent, selection.effect, context),
        ).toBe(false);
        currentText = KEYED_RECORD_PROOF_REACT_DIRECTIVE + code;
        const regexSpy = vi.spyOn(KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN, "test");
        try {
          expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
            true,
          );
          expect(hasKeyedImmutableRecordReset(selection.component, selection.effect, context)).toBe(
            true,
          );
          expect(regexSpy).toHaveBeenCalledTimes(1);
        } finally {
          regexSpy.mockRestore();
        }
      }
    },
  );
});
