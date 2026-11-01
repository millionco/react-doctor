import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { runRule } from "../../test-utils/run-rule.js";
import {
  NATIVE_PATH_PROOF_COUNTS,
  NATIVE_PATH_PROOF_CONTEXT_ORDERS,
  NATIVE_PATH_PROOF_WARNING_COUNT,
  NATIVE_PATH_PROOF_TEMPLATE_EXPRESSION_COUNT,
  NATIVE_PATH_PROOF_PROGRAM_BODY_LIMIT,
  NATIVE_PATH_PROOF_PROVIDER_REFERENCE_PASSES,
  NATIVE_PATH_PROOF_AST_READS_PER_NODE,
} from "../../test-utils/native-path-proof/constants.js";
import { noUnescapedDynamicStringInRegexp } from "../rules/correctness/no-unescaped-dynamic-string-in-regexp.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { hasUnescapedNativeNodePathPattern } from "./has-unescaped-native-node-path-pattern.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

interface NativePathContextCase {
  name: string;
  code: string;
  expected: boolean[];
}

const flattenSingleTemplate = (node: EsTreeNode): Array<string | EsTreeNode> | null => {
  if (
    !isNodeOfType(node, "TemplateLiteral") ||
    node.expressions.length !== NATIVE_PATH_PROOF_TEMPLATE_EXPRESSION_COUNT
  )
    return null;
  const [firstQuasi, secondQuasi] = node.quasis;
  const [expression] = node.expressions;
  if (!firstQuasi || !secondQuasi || !expression) return null;
  return [
    firstQuasi.value.cooked ?? firstQuasi.value.raw,
    expression,
    secondQuasi.value.cooked ?? secondQuasi.value.raw,
  ];
};

describe("native path provider cold work", () => {
  for (const isCommonJs of [true, false]) {
    for (const count of NATIVE_PATH_PROOF_COUNTS) {
      it(`${count} native patterns with ${isCommonJs ? "CommonJS" : "namespace"} provider`, () => {
        const provider = isCommonJs
          ? "const nativePaths=require('node:path');"
          : "import * as nativePaths from 'node:path';";
        const code =
          provider +
          "\n" +
          Array.from(
            { length: count },
            (_, patternIndex) =>
              `const rootPath${patternIndex}=nativePaths.resolve(__dirname,'assets');\nconst matcher${patternIndex}=new RegExp(\`\${rootPath${patternIndex}}/bundle/.*\`);`,
          ).join("\n") +
          "\n";
        const rejectedCode = code + "consume(nativePaths);\n";
        for (const isRejected of [false, true]) {
          const selectedCode = isRejected ? rejectedCode : code;
          const parsed = parseFixture(selectedCode);
          attachParentReferences(parsed.program);
          const scopes = analyzeScopes(parsed.program);
          const constructions: EsTreeNodeOfType<"NewExpression">[] = [];
          const nodes: EsTreeNode[] = [];
          walkAst(parsed.program, (node) => {
            nodes.push(node);
            if (
              isNodeOfType(node, "NewExpression") &&
              isNodeOfType(node.callee, "Identifier") &&
              node.callee.name === "RegExp"
            )
              constructions.push(node);
          });
          let programBodyReads = 0;
          let providerReferenceVisits = 0;
          let producerReferenceVisits = 0;
          let astTypeReads = 0;
          const pendingScopes = [scopes.rootScope];
          while (pendingScopes.length > 0) {
            const scope = pendingScopes.pop();
            if (!scope) break;
            pendingScopes.push(...scope.children);
            for (const symbol of scope.symbols) {
              const references = symbol.references;
              Object.defineProperty(symbol, "references", {
                configurable: true,
                value: new Proxy(references, {
                  get(target, property, receiver) {
                    if (typeof property === "string" && /^\d+$/.test(property)) {
                      if (symbol.name === "nativePaths") providerReferenceVisits++;
                      if (symbol.name.startsWith("rootPath")) producerReferenceVisits++;
                    }
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
          const readPattern = (node: EsTreeNodeOfType<"NewExpression">): boolean => {
            const argument = node.arguments[0];
            if (!argument) throw new Error("Expected native pattern argument");
            return hasUnescapedNativeNodePathPattern(
              node,
              argument,
              scopes,
              flattenSingleTemplate,
              () => false,
            );
          };
          expect(parsed.errors).toEqual([]);
          expect(constructions).toHaveLength(count);
          expect(constructions.map(readPattern)).toEqual(
            Array.from({ length: count }, () => !isRejected),
          );
          expect(programBodyReads).toBeLessThanOrEqual(NATIVE_PATH_PROOF_PROGRAM_BODY_LIMIT);
          expect(providerReferenceVisits).toBeLessThanOrEqual(
            count * NATIVE_PATH_PROOF_PROVIDER_REFERENCE_PASSES,
          );
          expect(producerReferenceVisits).toBeLessThanOrEqual(count);
          expect(astTypeReads).toBeLessThanOrEqual(
            nodes.length * NATIVE_PATH_PROOF_AST_READS_PER_NODE,
          );
          const coldProgramBodyReads = programBodyReads;
          expect(constructions.toReversed().map(readPattern)).toEqual(
            Array.from({ length: count }, () => !isRejected),
          );
          expect(programBodyReads).toBe(coldProgramBodyReads);
          const actual = runRule(noUnescapedDynamicStringInRegexp, selectedCode, {
            filename: "/synthetic/native-path/work.js",
            settings: { "react-doctor": { capabilities: [] } },
            includeLocations: true,
          });
          expect(actual.parseErrors).toEqual([]);
          expect(actual.diagnostics).toHaveLength(isRejected ? 0 : count);
        }
      });
    }
  }
});

const cases: NativePathContextCase[] = [
  {
    name: "declaration-before-current-reference",
    code: "const nativePaths=require('node:path');\nconst before=new RegExp(`${rootPath0}/bundle/.*`);\nconst rootPath0=nativePaths.resolve(__dirname,'assets');\nconst after=new RegExp(`${rootPath0}/bundle/.*`);\n",
    expected: [false, true],
  },
  {
    name: "current-literal-prefix-role",
    code: "const nativePaths=require('node:path');\nconst rootPath0=nativePaths.resolve(__dirname,'assets');\nconst supported=new RegExp(`${rootPath0}/bundle/.*`);\nconst unsupported=new RegExp(`label${rootPath0}/bundle/.*`);\n",
    expected: [true, false],
  },
  {
    name: "alias-depth-shared-tail",
    code: "const nativePaths=require('node:path');\nconst rootPath0=nativePaths.resolve(__dirname,'assets');\nconst rootPath1=rootPath0;\nconst rootPath2=rootPath1;\nconst supported=new RegExp(`${rootPath1}/bundle/.*`);\nconst unsupported=new RegExp(`${rootPath2}/bundle/.*`);\n",
    expected: [true, false],
  },
];

describe("native path per-use cache boundaries", () => {
  for (const scenario of cases) {
    for (const order of NATIVE_PATH_PROOF_CONTEXT_ORDERS) {
      it(`${scenario.name} in initial order ${order.join(",")}`, () => {
        const parsed = parseFixture(scenario.code);
        attachParentReferences(parsed.program);
        const constructions: EsTreeNodeOfType<"NewExpression">[] = [];
        walkAst(parsed.program, (node) => {
          if (
            isNodeOfType(node, "NewExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "RegExp"
          )
            constructions.push(node);
        });
        expect(parsed.errors).toEqual([]);
        expect(constructions).toHaveLength(scenario.expected.length);
        for (const scopes of [analyzeScopes(parsed.program), analyzeScopes(parsed.program)]) {
          const readPattern = (index: number, isGuarded = false): boolean => {
            const construction = constructions[index];
            const argument = construction?.arguments[0];
            if (!construction || !argument) throw new Error("Expected native pattern argument");
            return hasUnescapedNativeNodePathPattern(
              construction,
              argument,
              scopes,
              flattenSingleTemplate,
              () => isGuarded,
            );
          };
          const sequence = [...order, ...order, ...order.toReversed()];
          expect(sequence.map((index) => readPattern(index))).toEqual(
            sequence.map((index) => scenario.expected[index]),
          );
          const supportedIndex = scenario.expected.findIndex(Boolean);
          expect(readPattern(supportedIndex, true)).toBe(false);
          expect(readPattern(supportedIndex)).toBe(true);
        }
        const actual = runRule(noUnescapedDynamicStringInRegexp, scenario.code, {
          filename: "/synthetic/native-path/context.js",
          settings: { "react-doctor": { capabilities: [] } },
          includeLocations: true,
        });
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(NATIVE_PATH_PROOF_WARNING_COUNT);
      });
    }
  }
});
