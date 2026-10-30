import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes, type SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CHART_PROOF_COUNTS,
  CHART_PROOF_AST_READS_PER_NODE,
  CHART_PROOF_STATE_REFERENCE_PASSES,
  CHART_PROOF_STATE_FIXED_READS,
  CHART_PROOF_STATEMENT_VISITS_PER_WRITE,
  CHART_PROOF_PROVIDER_REFERENCE_LIMIT,
  CHART_PROOF_PROGRAM_BODY_LIMIT,
} from "../../../test-utils/chart-options-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";
import { isOwnedChartOptionsStateAssignment } from "./utils/is-owned-chart-options-state-assignment.js";
const baseCode =
  'import React, { useEffect, useRef, useState } from "react";\nimport { Chart, LineController } from "chart.js";\nChart.register(LineController);\nexport const PlotPanel = ({ data, tone, darkMode }) => {\n  const canvas = useRef(null);\n  const [chart, setChart] = useState(null);\n  useEffect(() => {\n    const context = canvas.current;\n    const instance = new Chart(context, { type: "line", data, options: { plugins: { tooltip: { bodyColor: "gray", backgroundColor: "white" } }, scales: { x: { ticks: { color: "gray" } } } } });\n    setChart(instance);\n    return () => instance.destroy();\n  }, []);\n  useEffect(() => {\n    if (!chart) return;\n    chart.options.plugins.tooltip.bodyColor = tone;\n    chart.update("none");\n  }, [tone]);\n  return <canvas ref={canvas} />;\n};\n';
const settings = {
  "react-doctor": {
    capabilities: ["react"],
    framework: "unknown",
    reactVersion: "19.0.0",
    reactMajorVersion: 19,
    preactVersion: null,
    preactMajorVersion: null,
    hasReactNativeWorkspace: false,
    hasReactCompiler: false,
  },
};
const measure = (source: string) => {
  const parsed = parseFixture(source);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const nodes: EsTreeNode[] = [],
    assignments: EsTreeNodeOfType<"AssignmentExpression">[] = [],
    symbols = new Set<SymbolDescriptor>();
  let declarator: EsTreeNodeOfType<"VariableDeclarator"> | undefined;
  let component: EsTreeNode | undefined;
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (isNodeOfType(node, "AssignmentExpression")) assignments.push(node);
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "ArrayPattern") &&
      isNodeOfType(node.id.elements[0], "Identifier") &&
      node.id.elements[0].name === "chart"
    ) {
      declarator = node;
      component = node.parent?.parent ?? undefined;
    }
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (symbol) symbols.add(symbol);
    }
  });
  if (
    !declarator ||
    !component ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.id.elements[0], "Identifier")
  )
    throw Error("Missing chart state fixture");
  const selectedDeclarator = declarator,
    selectedComponent = component;
  const state = scopes.symbolFor(declarator.id.elements[0]);
  if (!state) throw Error("Missing state symbol");
  const cfg = analyzeControlFlow(parsed.program);
  const counters = {
    programBodyReads: 0,
    astTypeReads: 0,
    parentReads: 0,
    providerReferenceVisits: 0,
    stateReferenceVisits: 0,
    instanceReferenceVisits: 0,
    otherReferenceVisits: 0,
    updateStatementVisits: 0,
  };
  for (const symbol of symbols) {
    const key = ["useEffect", "useRef", "useState", "React", "Chart", "LineController"].includes(
      symbol.name,
    )
      ? "providerReferenceVisits"
      : symbol === state
        ? "stateReferenceVisits"
        : symbol.name === "instance"
          ? "instanceReferenceVisits"
          : "otherReferenceVisits";
    Object.defineProperty(symbol, "references", {
      configurable: true,
      value: new Proxy(symbol.references, {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) counters[key]++;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
  }
  if (!isNodeOfType(parsed.program, "Program")) throw Error("Expected Program fixture");
  const body = parsed.program.body;
  Object.defineProperty(parsed.program, "body", {
    configurable: true,
    enumerable: true,
    get() {
      counters.programBodyReads++;
      return body;
    },
  });
  const callback = findEnclosingFunction(assignments[0]);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    throw Error("Expected update callback");
  const selectedBlock = callback.body;
  const statements = selectedBlock.body;
  Object.defineProperty(selectedBlock, "body", {
    configurable: true,
    enumerable: true,
    value: new Proxy(statements, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property))
          counters.updateStatementVisits++;
        return Reflect.get(target, property, receiver);
      },
    }),
  });
  for (const node of nodes) {
    const type = node.type,
      parent = node.parent;
    Object.defineProperty(node, "type", {
      configurable: true,
      enumerable: true,
      get() {
        counters.astTypeReads++;
        return type;
      },
    });
    Object.defineProperty(node, "parent", {
      configurable: true,
      enumerable: false,
      get() {
        counters.parentReads++;
        return parent;
      },
    });
  }
  const context = {
    scopes,
    cfg,
    settings,
    sourceCode: { ast: parsed.program, getText: () => source },
    report: () => {},
  };
  const admitted = assignments.map((assignment) =>
    isOwnedChartOptionsStateAssignment(
      assignment,
      state,
      selectedDeclarator,
      selectedComponent,
      context,
    ),
  );
  const measured = { ...counters };
  return { parserErrors: parsed.errors, admitted, counters: measured, astNodes: nodes.length };
};
describe("owned chart options cold proof work", () => {
  for (const shape of ["flat-writes", "conditional-writes"])
    for (const count of CHART_PROOF_COUNTS)
      it(`${shape} ${count} cold writes`, () => {
        const writes = Array.from({ length: count }, () =>
          shape === "flat-writes"
            ? "chart.options.plugins.tooltip.bodyColor = tone;"
            : "if(darkMode){chart.options.plugins.tooltip.bodyColor = tone;}",
        ).join("\n");
        const code = baseCode.replace("chart.options.plugins.tooltip.bodyColor = tone;", writes);
        const last = code.lastIndexOf("chart.options.plugins.tooltip.bodyColor = tone;");
        const rejected =
          code.slice(0, last) +
          code.slice(last).replace("tooltip.bodyColor = tone;", "tooltip.titleColor = tone;");
        for (const [source, expected] of [
          [code, true],
          [rejected, false],
        ] satisfies ReadonlyArray<readonly [string, boolean]>) {
          const measured = measure(source);
          expect(measured.parserErrors).toEqual([]);
          expect(measured.admitted).toHaveLength(count);
          expect(measured.admitted).toEqual(Array.from({ length: count }, () => expected));
          expect(measured.counters.programBodyReads).toBeLessThanOrEqual(
            CHART_PROOF_PROGRAM_BODY_LIMIT,
          );
          expect(measured.counters.providerReferenceVisits).toBeLessThanOrEqual(
            CHART_PROOF_PROVIDER_REFERENCE_LIMIT,
          );
          expect(measured.counters.stateReferenceVisits).toBeLessThanOrEqual(
            (count + CHART_PROOF_STATE_FIXED_READS) * CHART_PROOF_STATE_REFERENCE_PASSES,
          );
          expect(measured.counters.updateStatementVisits).toBeLessThanOrEqual(
            count * CHART_PROOF_STATEMENT_VISITS_PER_WRITE,
          );
          expect(measured.counters.astTypeReads).toBeLessThanOrEqual(
            measured.astNodes * CHART_PROOF_AST_READS_PER_NODE,
          );
          const result = runRule(noDirectStateMutation, source, {
            filename: "/private/synthetic/chart-proof.tsx",
            settings,
            includeLocations: true,
          });
          expect(result.parseErrors).toEqual([]);
          expect(result.diagnostics).toHaveLength(expected ? 0 : count);
        }
      });
});

describe("owned chart options current context", () => {
  for (const shape of ["profile-current", "selected-assignment-current", "component-current"])
    it(`retains ${shape} before and after warming`, () => {
      const code =
        shape === "selected-assignment-current"
          ? baseCode.replace(
              "  return <canvas",
              "  external.options.plugins.tooltip.bodyColor = tone;\n  return <canvas",
            )
          : baseCode;
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const selections = new Map<string, EsTreeNodeOfType<"AssignmentExpression">>();
      let declarator: EsTreeNodeOfType<"VariableDeclarator"> | undefined;
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "VariableDeclarator") &&
          isNodeOfType(node.id, "ArrayPattern") &&
          isNodeOfType(node.id.elements[0], "Identifier") &&
          node.id.elements[0].name === "chart"
        )
          declarator = node;
        if (isNodeOfType(node, "AssignmentExpression")) {
          let member = node.left;
          while (isNodeOfType(member, "MemberExpression")) member = member.object;
          if (isNodeOfType(member, "Identifier")) selections.set(member.name, node);
        }
      });
      if (
        !declarator ||
        !isNodeOfType(declarator.id, "ArrayPattern") ||
        !isNodeOfType(declarator.id.elements[0], "Identifier") ||
        !declarator.parent?.parent
      )
        throw Error("Missing chart fixture declaration");
      const selectedDeclarator = declarator,
        stateIdentifier = declarator.id.elements[0],
        component = declarator.parent.parent;
      const analyses = [analyzeScopes(parsed.program), analyzeScopes(parsed.program)];
      for (const [analysisIndex, scopes] of analyses.entries()) {
        const state = scopes.symbolFor(stateIdentifier);
        if (!state) throw Error("Missing chart symbol");
        const currentSettings = structuredClone(settings),
          context = {
            scopes,
            cfg: analyzeControlFlow(parsed.program),
            settings: currentSettings,
            sourceCode: { ast: parsed.program, getText: () => code },
            report: () => {},
          };
        const order = analysisIndex === 0 ? [true, false] : [false, true],
          sequence = [...order, ...order, ...order.toReversed()];
        const actual = sequence.map((valid) => {
          currentSettings["react-doctor"].hasReactNativeWorkspace =
            shape === "profile-current" && !valid;
          const assignment = selections.get(
            shape === "selected-assignment-current" && !valid ? "external" : "chart",
          );
          if (!assignment) throw Error("Missing selected assignment");
          return isOwnedChartOptionsStateAssignment(
            assignment,
            state,
            selectedDeclarator,
            shape === "component-current" && !valid ? parsed.program : component,
            context,
          );
        });
        expect(actual).toEqual(sequence);
      }
      const actual = runRule(noDirectStateMutation, code, {
        filename: "/private/synthetic/chart-context.tsx",
        settings,
        includeLocations: true,
      });
      expect(actual.parseErrors).toEqual([]);
      expect(actual.diagnostics).toHaveLength(0);
    });
  it("retains two-constructor refusal in both analysis orders", () => {
    const start = baseCode.indexOf("export const PlotPanel"),
      code =
        baseCode +
        baseCode.slice(start).replace("export const PlotPanel", "export const PlotPanelOther");
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const declarators: EsTreeNodeOfType<"VariableDeclarator">[] = [],
      assignments: EsTreeNodeOfType<"AssignmentExpression">[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "VariableDeclarator") &&
        isNodeOfType(node.id, "ArrayPattern") &&
        isNodeOfType(node.id.elements[0], "Identifier") &&
        node.id.elements[0].name === "chart"
      )
        declarators.push(node);
      if (isNodeOfType(node, "AssignmentExpression")) assignments.push(node);
    });
    const analyses = [analyzeScopes(parsed.program), analyzeScopes(parsed.program)];
    for (const [analysisIndex, scopes] of analyses.entries()) {
      const order = analysisIndex === 0 ? [0, 1] : [1, 0],
        sequence = [...order, ...order, ...order.toReversed()],
        context = {
          scopes,
          cfg: analyzeControlFlow(parsed.program),
          settings,
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
      const actual = sequence.map((index) => {
        const declarator = declarators[index],
          assignment = assignments[index];
        if (
          !declarator ||
          !assignment ||
          !isNodeOfType(declarator.id, "ArrayPattern") ||
          !isNodeOfType(declarator.id.elements[0], "Identifier") ||
          !declarator.parent?.parent
        )
          throw Error("Missing independent chart fixture");
        const state = scopes.symbolFor(declarator.id.elements[0]);
        if (!state) throw Error("Missing chart symbol");
        return isOwnedChartOptionsStateAssignment(
          assignment,
          state,
          declarator,
          declarator.parent.parent,
          context,
        );
      });
      expect(actual).toEqual(sequence.map(() => false));
    }
    const actual = runRule(noDirectStateMutation, code, {
      filename: "/private/synthetic/chart-context.tsx",
      settings,
      includeLocations: true,
    });
    expect(actual.parseErrors).toEqual([]);
    expect(actual.diagnostics).toHaveLength(2);
  });
});
