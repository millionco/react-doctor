import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  TEXT_LEAF_PROOF_COUNTS,
  TEXT_LEAF_PROOF_CONTEXT_ORDERS,
  TEXT_LEAF_PROOF_PROGRAM_BODY_LIMIT,
  TEXT_LEAF_PROOF_PROVIDER_REFERENCE_PASSES,
  TEXT_LEAF_PROOF_AST_READS_PER_NODE,
  TEXT_LEAF_PROOF_CONTEXT_COUNT,
  TEXT_LEAF_PROOF_REACT_VERSION,
  TEXT_LEAF_PROOF_REJECTED_REACT_VERSION,
  TEXT_LEAF_PROOF_KEYS_PER_COMPONENT,
  TEXT_LEAF_PROOF_SOURCE_PRAGMA_PASSES,
} from "../../../test-utils/primitive-text-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isClosedPrimitiveTextLeafKey } from "./utils/is-closed-primitive-text-leaf-key.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";
import { TEXT_JSX_DIRECTIVE_PATTERN } from "./utils/primitive-text-leaf/constants.js";

const createPrimitiveTextProofSource = (count: number, isStyled: boolean): string => {
  const imports =
    'import React from "react";\n' + (isStyled ? 'import styled from "styled-components";\n' : "");
  return (
    imports +
    Array.from(
      { length: count },
      (_, index) =>
        `${isStyled ? `const Glyph${index}=styled.span\`\`;\n` : ""}function readChunks${index}(input:string){return input.match(/.{1,8}/g)??[];}\nfunction readPairs${index}(input:string){return input.match(/.{1,2}/g)??[];}\nexport const TextChunks${index}=()=>{const groups=readChunks${index}("abcdefghijkl").map(readPairs${index});return <section>{groups.map((group,index)=><div key={index}>{group.map((token,idx)=><${isStyled ? "Glyph" + index : "span"} key={idx}>{token}</${isStyled ? "Glyph" + index : "span"}>)}</div>)}</section>;};`,
    ).join("\n") +
    "\n"
  );
};

const createPrimitiveTextProofProfile = () => ({
  portedRuleMode: "curated",
  capabilities: ["react"],
  reactVersion: "17.0.1",
  reactMajorVersion: TEXT_LEAF_PROOF_REACT_VERSION,
  styledComponentsVersion: "5.3.3",
  framework: "unknown",
  hasReactCompiler: false,
  hasReactNativeWorkspace: false,
  preactVersion: null,
  preactMajorVersion: null,
});

const readPrimitiveTextProofLeaves = (program: EsTreeNode): EsTreeNodeOfType<"JSXAttribute">[] => {
  const leaves: EsTreeNodeOfType<"JSXAttribute">[] = [];
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "JSXAttribute") &&
      node.name.name === "key" &&
      isNodeOfType(node.value, "JSXExpressionContainer") &&
      isNodeOfType(node.value.expression, "Identifier") &&
      node.value.expression.name === "idx"
    )
      leaves.push(node);
  });
  return leaves;
};

describe("primitive text leaf cold program proof", () => {
  for (const isStyled of [false, true]) {
    for (const count of TEXT_LEAF_PROOF_COUNTS) {
      it(`${count} ${isStyled ? "styled" : "native"} leaves`, () => {
        for (const isRejected of [false, true]) {
          const code =
            createPrimitiveTextProofSource(count, isStyled) +
            (isRejected ? "void globalThis;\n" : "");
          const parsed = parseFixture(code);
          attachParentReferences(parsed.program);
          const scopes = analyzeScopes(parsed.program);
          const cfg = analyzeControlFlow(parsed.program);
          const leaves = readPrimitiveTextProofLeaves(parsed.program);
          const nodes: EsTreeNode[] = [];
          walkAst(parsed.program, (node) => {
            nodes.push(node);
          });
          let programBodyReads = 0;
          let providerReferenceVisits = 0;
          let astTypeReads = 0;
          let getTextCalls = 0;
          const pendingScopes = [scopes.rootScope];
          while (pendingScopes.length > 0) {
            const scope = pendingScopes.pop();
            if (!scope) break;
            pendingScopes.push(...scope.children);
            for (const symbol of scope.symbols) {
              if (symbol.name !== "React" && symbol.name !== "styled") continue;
              const references = symbol.references;
              Object.defineProperty(symbol, "references", {
                configurable: true,
                value: new Proxy(references, {
                  get(target, property, receiver) {
                    if (typeof property === "string" && /^\d+$/.test(property))
                      providerReferenceVisits++;
                    return Reflect.get(target, property, receiver);
                  },
                }),
              });
            }
          }
          if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
          const body = parsed.program.body;
          Object.defineProperty(parsed.program, "body", {
            configurable: true,
            get: () => {
              programBodyReads++;
              return body;
            },
          });
          for (const node of nodes) {
            const nodeType = node.type;
            Object.defineProperty(node, "type", {
              configurable: true,
              get: () => {
                astTypeReads++;
                return nodeType;
              },
            });
          }
          const context: RuleContext = {
            scopes,
            cfg,
            report: () => undefined,
            filename: "/synthetic/primitive-text/work.tsx",
            settings: { "react-doctor": createPrimitiveTextProofProfile() },
            sourceCode: {
              ast: parsed.program,
              getText: () => {
                getTextCalls++;
                return code;
              },
            },
          };
          const readLeaf = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean =>
            isClosedPrimitiveTextLeafKey(attribute, context, () => true);
          let pragmaSourceTests = 0;
          const originalTest = RegExp.prototype.test;
          RegExp.prototype.test = new Proxy(originalTest, {
            apply: (target, receiver, argumentsList) => {
              if (
                receiver instanceof RegExp &&
                receiver.source === TEXT_JSX_DIRECTIVE_PATTERN.source &&
                receiver.flags === TEXT_JSX_DIRECTIVE_PATTERN.flags &&
                argumentsList[0] === code
              )
                pragmaSourceTests++;
              return Reflect.apply(target, receiver, argumentsList);
            },
          });
          try {
            expect(parsed.errors).toEqual([]);
            expect(leaves).toHaveLength(count);
            expect(leaves.map(readLeaf)).toEqual(Array.from({ length: count }, () => !isRejected));
            expect(programBodyReads).toBeLessThanOrEqual(TEXT_LEAF_PROOF_PROGRAM_BODY_LIMIT);
            expect(providerReferenceVisits).toBeLessThanOrEqual(
              count * TEXT_LEAF_PROOF_PROVIDER_REFERENCE_PASSES,
            );
            expect(astTypeReads).toBeLessThanOrEqual(
              nodes.length * TEXT_LEAF_PROOF_AST_READS_PER_NODE,
            );
            expect(getTextCalls).toBe(count);
            expect(pragmaSourceTests).toBe(TEXT_LEAF_PROOF_SOURCE_PRAGMA_PASSES);
            const coldProgramBodyReads = programBodyReads;
            const coldProviderReferenceVisits = providerReferenceVisits;
            expect(leaves.toReversed().map(readLeaf)).toEqual(
              Array.from({ length: count }, () => !isRejected),
            );
            expect(programBodyReads).toBe(coldProgramBodyReads);
            expect(providerReferenceVisits).toBe(coldProviderReferenceVisits);
            expect(pragmaSourceTests).toBe(TEXT_LEAF_PROOF_SOURCE_PRAGMA_PASSES);
          } finally {
            RegExp.prototype.test = originalTest;
          }
          const actual = runRule(noArrayIndexAsKey, code, {
            filename: context.filename,
            settings: context.settings,
            includeLocations: true,
          });
          expect(actual.parseErrors).toEqual([]);
          expect(actual.diagnostics).toHaveLength(
            isRejected ? count * TEXT_LEAF_PROOF_KEYS_PER_COMPONENT : count,
          );
        }
      });
    }
  }
});

describe("primitive text leaf current source and profile", () => {
  for (const isStyled of [false, true]) {
    for (const order of TEXT_LEAF_PROOF_CONTEXT_ORDERS) {
      it(`${isStyled ? "styled" : "native"} current context in order ${order.join(",")}`, () => {
        const code = createPrimitiveTextProofSource(TEXT_LEAF_PROOF_CONTEXT_COUNT, isStyled);
        const parsed = parseFixture(code);
        attachParentReferences(parsed.program);
        const [attribute] = readPrimitiveTextProofLeaves(parsed.program);
        if (!attribute) throw new Error("Expected text leaf key");
        expect(parsed.errors).toEqual([]);
        for (const scopes of [analyzeScopes(parsed.program), analyzeScopes(parsed.program)]) {
          const profile = createPrimitiveTextProofProfile();
          let text = code;
          let shouldThrow = false;
          let hasSource = true;
          let isInput = true;
          const sourceCode = {
            ast: parsed.program,
            getText() {
              expect(this).toBe(sourceCode);
              if (shouldThrow) throw new Error("Unavailable source");
              return text;
            },
          };
          const context: RuleContext = {
            scopes,
            cfg: analyzeControlFlow(parsed.program),
            report: () => undefined,
            filename: "/synthetic/primitive-text/context.tsx",
            settings: { "react-doctor": profile },
            sourceCode,
          };
          const readLeaf = (): boolean =>
            isClosedPrimitiveTextLeafKey(
              attribute,
              { ...context, sourceCode: hasSource ? sourceCode : { ast: parsed.program } },
              () => isInput,
            );
          const sequence = [...order, ...order, ...order.toReversed()];
          for (const isRejected of sequence) {
            text = isRejected ? "/** @jsx h */\n" + code : code;
            expect(readLeaf()).toBe(!isRejected);
          }
          text = code;
          for (const isRejected of sequence) {
            profile.reactMajorVersion = isRejected
              ? TEXT_LEAF_PROOF_REJECTED_REACT_VERSION
              : TEXT_LEAF_PROOF_REACT_VERSION;
            expect(readLeaf()).toBe(!isRejected);
          }
          profile.reactMajorVersion = TEXT_LEAF_PROOF_REACT_VERSION;
          hasSource = false;
          expect(readLeaf()).toBe(false);
          hasSource = true;
          shouldThrow = true;
          expect(readLeaf()).toBe(false);
          shouldThrow = false;
          expect(readLeaf()).toBe(true);
          isInput = false;
          expect(readLeaf()).toBe(false);
          isInput = true;
          expect(readLeaf()).toBe(true);
        }
      });
    }
  }
});
