import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  NATIVE_SUBMIT_PROOF_COUNTS,
  MAX_NATIVE_SUBMIT_PROGRAM_BODY_READS,
  MAX_NATIVE_SUBMIT_REFERENCE_PASSES,
  MAX_NATIVE_SUBMIT_CHILD_PASSES,
  MAX_NATIVE_SUBMIT_PRAGMA_SOURCE_PASSES,
} from "../../../test-utils/native-submit-proof/constants.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { reactRouterNoNavigateInRender } from "./react-router-no-navigate-in-render.js";
import { isClosedNativeSubmitNavigation } from "./utils/is-closed-native-submit-navigation.js";

describe("closed native submit cold proof work", () => {
  for (const sharedHelper of [true, false]) {
    for (const count of NATIVE_SUBMIT_PROOF_COUNTS) {
      it(`${count} navigation calls with ${sharedHelper ? "one helper" : "independent helpers and forms"} reuse immutable facts`, () => {
        const declarations = sharedHelper
          ? `const SAVE_RECORD=()=>{${Array.from({ length: count }, () => `navigate('/next');`).join("")}};const onSubmit=(event:{preventDefault():void})=>{event.preventDefault();SAVE_RECORD()};`
          : Array.from(
              { length: count },
              (_, index) =>
                `const SAVE_RECORD${index}=()=>navigate('/next');const onSubmit${index}=(event:{preventDefault():void})=>{event.preventDefault();SAVE_RECORD${index}()};`,
            ).join("");
        const markup = sharedHelper
          ? "<form onSubmit={onSubmit}/>"
          : `<div>${Array.from({ length: count }, (_, index) => `<form onSubmit={onSubmit${index}}/>`).join("")}</div>`;
        const source = `import{useNavigate}from'react-router-dom';export const Screen=()=>{const navigate=useNavigate();${declarations}return ${markup}};`;
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const cfg = analyzeControlFlow(program);
        const nodes: EsTreeNode[] = [];
        const calls: EsTreeNodeOfType<"CallExpression">[] = [];
        const declarationsFound: EsTreeNodeOfType<"VariableDeclarator">[] = [];
        const symbols = new Set<SymbolDescriptor>();
        walkAst(program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "navigate"
          )
            calls.push(node);
          if (
            isNodeOfType(node, "VariableDeclarator") &&
            isNodeOfType(node.id, "Identifier") &&
            node.id.name === "navigate"
          )
            declarationsFound.push(node);
          if (isNodeOfType(node, "Identifier")) {
            const symbol = scopes.symbolFor(node);
            if (symbol) symbols.add(symbol);
          }
        });
        const navigateDeclaration = declarationsFound[0];
        if (!navigateDeclaration) throw new Error("Expected navigate declaration");
        let programBodyReads = 0;
        let getTextCalls = 0;
        let sourcePragmaCharactersSubmitted = 0;
        let referenceVisits = 0;
        let referenceCount = 0;
        let childVisits = 0;
        let childCount = 0;
        for (const symbol of symbols) {
          if (
            symbol.name !== "navigate" &&
            symbol.kind !== "import" &&
            !symbol.name.startsWith("SAVE_RECORD") &&
            !symbol.name.startsWith("onSubmit")
          )
            continue;
          const references = symbol.references;
          referenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            value: new Proxy(references, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property)) referenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        const body = program.body;
        Object.defineProperty(program, "body", {
          enumerable: true,
          get: () => {
            programBodyReads += 1;
            return body;
          },
        });
        for (const node of nodes) {
          if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) continue;
          const children = node.children;
          childCount += children.length;
          Object.defineProperty(node, "children", {
            enumerable: true,
            value: new Proxy(children, {
              get: (target, property, receiver) => {
                if (typeof property === "string" && /^\d+$/.test(property)) childVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        const settings = {
          "react-doctor": { portedRuleMode: "curated", capabilities: ["react", "react-router"] },
        };
        const context = {
          scopes,
          cfg,
          settings,
          sourceCode: {
            ast: program,
            getText: () => {
              getTextCalls += 1;
              return source;
            },
          },
          report: () => {},
        };
        expect(calls).toHaveLength(count);
        const originalTest = RegExp.prototype.test;
        RegExp.prototype.test = new Proxy(originalTest, {
          apply: (target, receiver, argumentsList) => {
            if (
              receiver instanceof RegExp &&
              receiver.source === "@jsx(?:\\s|Frag|ImportSource|Runtime)"
            )
              sourcePragmaCharactersSubmitted += String(argumentsList[0]).length;
            return Reflect.apply(target, receiver, argumentsList);
          },
        });
        try {
          expect(
            calls.every((call) =>
              isClosedNativeSubmitNavigation(call, navigateDeclaration, context),
            ),
          ).toBe(true);
        } finally {
          RegExp.prototype.test = originalTest;
        }
        expect(getTextCalls).toBe(count);
        expect(sourcePragmaCharactersSubmitted).toBeLessThanOrEqual(
          source.length * MAX_NATIVE_SUBMIT_PRAGMA_SOURCE_PASSES,
        );
        expect(programBodyReads).toBeLessThanOrEqual(MAX_NATIVE_SUBMIT_PROGRAM_BODY_READS);
        expect(referenceVisits).toBeLessThanOrEqual(
          referenceCount * MAX_NATIVE_SUBMIT_REFERENCE_PASSES,
        );
        expect(childVisits).toBeLessThanOrEqual(childCount * MAX_NATIVE_SUBMIT_CHILD_PASSES);
        const options = { filename: "/synthetic/native-submit-proof/screen.tsx", settings };
        const actual = runRule(reactRouterNoNavigateInRender, source, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toEqual([]);
        const rejectedSource = source.replace(
          "return " + markup,
          (sharedHelper ? "SAVE_RECORD();" : "SAVE_RECORD0();") + "return " + markup,
        );
        const rejected = runRule(reactRouterNoNavigateInRender, rejectedSource, options);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(sharedHelper ? count : 1);
      });
    }
  }
});
