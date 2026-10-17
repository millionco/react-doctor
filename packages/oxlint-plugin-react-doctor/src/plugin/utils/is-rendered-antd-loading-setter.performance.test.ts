import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { runRule } from "../../test-utils/run-rule.js";
import {
  ANTD_LOADING_PROOF_COUNTS,
  MAX_ANTD_LOADING_PROGRAM_PASSES,
  MAX_ANTD_LOADING_REFERENCE_PASSES,
  MAX_ANTD_LOADING_CHILD_PASSES,
  MAX_ANTD_LOADING_AST_READS_PER_NODE,
} from "../../test-utils/antd-loading-role-proof/constants.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import { noLoadingFlagResetOutsideFinally } from "../rules/state-and-effects/no-loading-flag-reset-outside-finally.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isRenderedAntdLoadingSetter } from "./is-rendered-antd-loading-setter.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface AntdLoadingProofCounters {
  programBodyReads: number;
  providerReferenceVisits: number;
  controlledReferenceVisits: number;
  jsxChildVisits: number;
  jsxMembershipCallbackVisits: number;
  astTypeReads: number;
}

describe("cold AntD loading role proof work", () => {
  for (const independentComponents of [true, false]) {
    for (const count of ANTD_LOADING_PROOF_COUNTS) {
      it(`${count} independent roles in ${independentComponents ? "separate components" : "one component"} reuse immutable proof work`, () => {
        const createStateDeclaration = (index: number): string =>
          `const[phase${index},changePhase${index}]=useState(false);const submit${index}=async()=>{changePhase${index}(true);try{await performTask();changePhase${index}(false)}catch{}};`;
        const createButtonElement = (index: number): string =>
          `<Button loading={phase${index}} onClick={submit${index}}>Run</Button>`;
        const declarations = Array.from({ length: count }, (_, index) =>
          independentComponents
            ? `export const Panel${index}=()=>{${createStateDeclaration(index)}return ${createButtonElement(index)}};`
            : createStateDeclaration(index),
        ).join("\n");
        const body = independentComponents
          ? declarations
          : `export const Panel=()=>{${declarations}\nreturn <div>${Array.from({ length: count }, (_, index) => createButtonElement(index)).join("")}</div>};`;
        const code = `import{useState}from'react';import{Button}from'antd';import{performTask}from'./task-provider';\n${body}`;
        const rejectCode = code.replace("from'antd'", "from'foreign-ui'");
        const parsed = parseFixture(code);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const program = parsed.program;
        if (!isNodeOfType(program, "Program")) throw new Error("Expected Program");
        const scopes = analyzeScopes(program);
        const cfg = analyzeControlFlow(program);
        const nodes: EsTreeNode[] = [];
        const symbols = new Set<SymbolDescriptor>();
        const selected: EsTreeNode[] = [];
        walkAst(program, (node) => {
          nodes.push(node);
          if (!isNodeOfType(node, "Identifier")) return;
          const symbol = scopes.symbolFor(node);
          if (symbol) symbols.add(symbol);
          const call = node.parent;
          if (
            /^changePhase\d+$/u.test(node.name) &&
            isNodeOfType(call, "CallExpression") &&
            call.callee === node &&
            isNodeOfType(call.arguments[0], "Literal") &&
            call.arguments[0].value === true
          )
            selected.push(node);
        });
        const counters: AntdLoadingProofCounters = {
          programBodyReads: 0,
          providerReferenceVisits: 0,
          controlledReferenceVisits: 0,
          jsxChildVisits: 0,
          jsxMembershipCallbackVisits: 0,
          astTypeReads: 0,
        };
        const instrumentArray = <Value>(
          array: readonly Value[],
          counter: keyof AntdLoadingProofCounters,
        ): readonly Value[] =>
          new Proxy(array, {
            get(target, key, receiver) {
              if (typeof key === "string" && /^\d+$/u.test(key)) counters[counter] += 1;
              return Reflect.get(target, key, receiver);
            },
          });
        let providerReferenceCount = 0;
        let controlledReferenceCount = 0;
        for (const symbol of symbols) {
          const references = symbol.references;
          const source = getValueImportSource(symbol);
          const provider = source === "react" || source === "antd";
          if (provider) providerReferenceCount += references.length;
          else controlledReferenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            configurable: true,
            value: instrumentArray(
              references,
              provider ? "providerReferenceVisits" : "controlledReferenceVisits",
            ),
          });
        }
        const bodyNodes = program.body;
        Object.defineProperty(program, "body", {
          configurable: true,
          get: () => {
            counters.programBodyReads += 1;
            return bodyNodes;
          },
        });
        let childCount = 0;
        for (const node of nodes) {
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            configurable: true,
            get: () => {
              counters.astTypeReads += 1;
              return nodeType;
            },
          });
          if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) continue;
          const children = node.children;
          childCount += children.length;
          Object.defineProperty(node, "children", {
            configurable: true,
            value: new Proxy(children, {
              get(target, key, receiver) {
                if (key === "some")
                  return (predicate: (child: EsTreeNode, index: number) => unknown) =>
                    target.some((child, index) => {
                      counters.jsxMembershipCallbackVisits += 1;
                      return predicate(child, index);
                    });
                if (typeof key === "string" && /^\d+$/u.test(key)) counters.jsxChildVisits += 1;
                return Reflect.get(target, key, receiver);
              },
            }),
          });
        }
        counters.astTypeReads = 0;
        const context = { scopes, cfg, report: () => {} };
        const admissions = selected.map((identifier) =>
          isRenderedAntdLoadingSetter(identifier, context),
        );
        const measured = { ...counters };
        expect(selected).toHaveLength(count);
        expect(admissions.every(Boolean)).toBe(true);
        expect(measured.programBodyReads).toBeLessThanOrEqual(MAX_ANTD_LOADING_PROGRAM_PASSES);
        expect(measured.providerReferenceVisits).toBeLessThanOrEqual(
          providerReferenceCount * MAX_ANTD_LOADING_REFERENCE_PASSES,
        );
        expect(measured.controlledReferenceVisits).toBeLessThanOrEqual(
          controlledReferenceCount * MAX_ANTD_LOADING_REFERENCE_PASSES,
        );
        expect(measured.jsxChildVisits).toBeLessThanOrEqual(
          childCount * MAX_ANTD_LOADING_CHILD_PASSES,
        );
        expect(measured.jsxMembershipCallbackVisits).toBeLessThanOrEqual(childCount);
        expect(measured.astTypeReads).toBeLessThanOrEqual(
          nodes.length * MAX_ANTD_LOADING_AST_READS_PER_NODE,
        );
        const options = {
          filename: "/synthetic/antd-loading-cold/panel.tsx",
          includeLocations: true,
          settings: {
            "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react:18"] },
          },
        };
        const actual = runRule(noLoadingFlagResetOutsideFinally, code, options);
        const rejected = runRule(noLoadingFlagResetOutsideFinally, rejectCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(rejected.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(count);
        expect(rejected.diagnostics).toEqual([]);
      });
    }
  }
});
