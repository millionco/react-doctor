import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { attachSourceLocations } from "../../../test-utils/attach-source-locations.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  BODY_ARRAY_COMPONENT_COUNTS,
  BODY_ARRAY_CONTEXT_SOURCE,
  BODY_ARRAY_RULE_OPTIONS,
  BODY_ARRAY_MAX_AST_READS_PER_CODE_UNIT,
  BODY_ARRAY_MAX_PROGRAM_BODY_READS,
  BODY_ARRAY_MAX_PROVIDER_REFERENCES_PER_COMPONENT,
  BODY_ARRAY_MAX_REFERENCES_PER_COMPONENT,
  BODY_ARRAY_NOMINAL_SOURCE,
  BODY_ARRAY_PROVIDER_REFERENCE_ALLOWANCE,
  BODY_ARRAY_REFERENCE_ALLOWANCE,
  BODY_ARRAY_REJECTED_CONTEXT_REPEAT_COUNT,
} from "../../../test-utils/body-array-proof/constants.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";
import { getBodyArrayPropMirror } from "./utils/get-body-array-prop-mirror.js";

interface BodyArraySelection {
  initializer: EsTreeNode;
  componentBody: EsTreeNode;
  effectCall: EsTreeNode;
}

interface BodyArrayWork {
  astReads: number;
  referenceReads: number;
  providerReferenceReads: number;
  programBodyReads: number;
}

interface BodyArrayFixture {
  program: EsTreeNode;
  scopes: ScopeAnalysis;
  selections: BodyArraySelection[];
  nodes: EsTreeNode[];
}

const buildBodyArrayFixture = (componentCount: number, extraDependency: boolean): string => {
  const [imports, annotation, ...componentLines] = BODY_ARRAY_NOMINAL_SOURCE.split("\n");
  if (!imports || !annotation || componentLines.length === 0) throw new Error("Missing fixture");
  const component = componentLines.join("\n");
  const source = `${imports}\n${annotation}\n${Array.from(
    { length: componentCount },
    (_, componentIndex) => component.replaceAll("Panel", `Panel${componentIndex}`),
  ).join("")}`;
  return extraDependency
    ? source
        .replace(
          "interface ArrayProps { data: string[] }",
          "interface ArrayProps { data: string[]; resetNonce: number }",
        )
        .replaceAll("data: sourceValue }", "data: sourceValue, resetNonce }")
        .replaceAll("[sourceValue]);", "[sourceValue, resetNonce]);")
    : source;
};

const prepareBodyArrayFixture = (code: string): BodyArrayFixture => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("Missing Program");
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, code);
  const scopes = analyzeScopes(parsed.program);
  analyzeControlFlow(parsed.program);
  const selections: BodyArraySelection[] = [];
  const nodes: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    nodes.push(node);
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.callee, "Identifier") ||
      node.callee.name !== "useState"
    )
      return;
    let componentBody = node.parent;
    while (componentBody && !isNodeOfType(componentBody, "BlockStatement"))
      componentBody = componentBody.parent;
    const initializer = node.arguments[0];
    if (!initializer || !isNodeOfType(componentBody, "BlockStatement"))
      throw new Error("Missing state initializer");
    const effectStatement = componentBody.body.find(
      (statement) =>
        isNodeOfType(statement, "ExpressionStatement") &&
        isNodeOfType(statement.expression, "CallExpression") &&
        isNodeOfType(statement.expression.callee, "Identifier") &&
        statement.expression.callee.name === "useEffect",
    );
    if (
      !isNodeOfType(effectStatement, "ExpressionStatement") ||
      !isNodeOfType(effectStatement.expression, "CallExpression")
    )
      throw new Error("Missing selected effect");
    selections.push({ initializer, componentBody, effectCall: effectStatement.expression });
  });
  return { program: parsed.program, scopes, selections, nodes };
};

const observeBodyArrayWork = (
  program: EsTreeNode,
  nodes: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): BodyArrayWork => {
  const work: BodyArrayWork = {
    astReads: 0,
    referenceReads: 0,
    providerReferenceReads: 0,
    programBodyReads: 0,
  };
  const pendingScopes: ScopeDescriptor[] = [scopes.rootScope];
  while (pendingScopes.length > 0) {
    const scope = pendingScopes.pop();
    if (!scope) continue;
    pendingScopes.push(...scope.children);
    for (const symbol of scope.symbols) {
      Object.defineProperty(symbol, "references", {
        configurable: true,
        value: new Proxy(symbol.references, {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) {
              work.referenceReads++;
              if (symbol.name === "useState" || symbol.name === "useEffect")
                work.providerReferenceReads++;
            }
            return Reflect.get(target, property, receiver);
          },
        }),
      });
    }
  }
  for (const node of nodes) {
    const nodeType = node.type;
    Object.defineProperty(node, "type", {
      configurable: true,
      get: () => {
        work.astReads++;
        return nodeType;
      },
    });
  }
  if (!isNodeOfType(program, "Program")) throw new Error("Missing Program");
  const statements = program.body;
  Object.defineProperty(program, "body", {
    configurable: true,
    get: () => {
      work.programBodyReads++;
      return statements;
    },
  });
  work.astReads = 0;
  return work;
};

const expectBodyArraySelection = (
  selection: BodyArraySelection,
  scopes: ScopeAnalysis,
  expected: boolean,
): void => {
  const result = getBodyArrayPropMirror({ ...selection, scopes });
  expect(Boolean(result)).toBe(expected);
  if (result) expect(result.effectCall).toBe(selection.effectCall);
};

describe("body array mirror module proof work and current selections", () => {
  for (const extraDependency of [false, true]) {
    for (const componentCount of BODY_ARRAY_COMPONENT_COUNTS) {
      it(`bounds cold work for ${componentCount} components, extra dependency ${extraDependency}`, () => {
        const code = buildBodyArrayFixture(componentCount, extraDependency);
        const fixture = prepareBodyArrayFixture(code);
        expect(fixture.selections).toHaveLength(componentCount);
        const work = observeBodyArrayWork(fixture.program, fixture.nodes, fixture.scopes);
        for (const selection of fixture.selections)
          expectBodyArraySelection(selection, fixture.scopes, !extraDependency);
        expect(work.astReads).toBeLessThanOrEqual(
          code.length * BODY_ARRAY_MAX_AST_READS_PER_CODE_UNIT,
        );
        expect(work.referenceReads).toBeLessThanOrEqual(
          componentCount * BODY_ARRAY_MAX_REFERENCES_PER_COMPONENT + BODY_ARRAY_REFERENCE_ALLOWANCE,
        );
        expect(work.providerReferenceReads).toBeLessThanOrEqual(
          componentCount * BODY_ARRAY_MAX_PROVIDER_REFERENCES_PER_COMPONENT +
            BODY_ARRAY_PROVIDER_REFERENCE_ALLOWANCE,
        );
        expect(work.programBodyReads).toBeLessThanOrEqual(BODY_ARRAY_MAX_PROGRAM_BODY_READS);
        const result = runRule(noMirrorPropEffect, code, BODY_ARRAY_RULE_OPTIONS);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(extraDependency ? 0 : componentCount);
      });
    }
  }

  it("keeps dependency and effect identities fresh across analyses and visit orders", () => {
    const source = BODY_ARRAY_CONTEXT_SOURCE;
    const fixture = prepareBodyArrayFixture(source);
    const secondAnalysis = analyzeScopes(fixture.program);
    expect(secondAnalysis).not.toBe(fixture.scopes);
    expect(secondAnalysis.rootScope.node).toBe(fixture.program);
    for (const [analysisIndex, scopes] of [fixture.scopes, secondAnalysis].entries()) {
      const ordered = analysisIndex === 0 ? [...fixture.selections].reverse() : fixture.selections;
      for (const selections of [ordered, ordered, [...ordered].reverse()]) {
        for (const selection of selections)
          expectBodyArraySelection(selection, scopes, selection === fixture.selections[0]);
      }
    }
  });

  it("reuses rejected module facts without admitting either selected effect", () => {
    const source = `eval("void 0");\n${BODY_ARRAY_CONTEXT_SOURCE}`;
    const fixture = prepareBodyArrayFixture(source);
    const work = observeBodyArrayWork(fixture.program, fixture.nodes, fixture.scopes);
    for (
      let repeatIndex = 0;
      repeatIndex < BODY_ARRAY_REJECTED_CONTEXT_REPEAT_COUNT;
      repeatIndex++
    ) {
      for (const selection of [...fixture.selections].reverse())
        expectBodyArraySelection(selection, fixture.scopes, false);
    }
    expect(work.programBodyReads).toBeLessThanOrEqual(BODY_ARRAY_MAX_PROGRAM_BODY_READS);
    const result = runRule(noMirrorPropEffect, source, BODY_ARRAY_RULE_OPTIONS);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
