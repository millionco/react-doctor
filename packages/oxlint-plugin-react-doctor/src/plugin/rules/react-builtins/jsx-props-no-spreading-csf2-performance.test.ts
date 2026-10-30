import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CSF2_AST_READS_PER_NODE,
  CSF2_COLD_PROOF_COUNTS,
  CSF2_PARENT_READS_PER_NODE,
  CSF2_PROGRAM_BODY_READ_LIMIT,
  CSF2_PROGRAM_STATEMENT_PASSES,
} from "../../../test-utils/csf2-proof/constants.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { jsxPropsNoSpreading } from "./jsx-props-no-spreading.js";
import { isCsf2BoundTemplateForwarding } from "./utils/is-csf2-bound-template-forwarding.js";

describe("closed CSF2 cold proof work", () => {
  for (const boundStories of [true, false]) {
    for (const count of CSF2_COLD_PROOF_COUNTS) {
      it(`${count} ${boundStories ? "bound stories" : "closed computed logical data terms"}`, () => {
        const prelude =
          'import { ActionCard } from "./action-card";export default {component:ActionCard};const Template=inputs=><ActionCard {...inputs}/>;';
        const code = boundStories
          ? prelude +
            Array.from(
              { length: count },
              (_, index) =>
                `export const Story${index}=Template.bind({});Story${index}.args={label:"Preview"};`,
            ).join("")
          : prelude +
            `export const Basic=Template.bind({});Basic.args={label:"Preview"};const selected=${Array.from({ length: count }, () => "data[key]").join("||")};void selected;`;
        const rejectedCode = boundStories
          ? code.replace("Template.bind({})", "Template.bind(custom)")
          : code.replace("void selected", "consume(selected)");
        const parsed = parseFixture(code);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program fixture");
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        const cfg = analyzeControlFlow(parsed.program);
        const nodes: EsTreeNode[] = [];
        const spreads: EsTreeNodeOfType<"JSXSpreadAttribute">[] = [];
        walkAst(parsed.program, (node) => {
          nodes.push(node);
          if (isNodeOfType(node, "JSXSpreadAttribute")) spreads.push(node);
        });
        let programBodyReads = 0;
        let statementVisits = 0;
        let parentReads = 0;
        let astTypeReads = 0;
        const statementCount = parsed.program.body.length;
        const body = new Proxy(parsed.program.body, {
          get(target, property, receiver) {
            if (typeof property === "string" && /^\d+$/.test(property)) statementVisits++;
            return Reflect.get(target, property, receiver);
          },
        });
        Object.defineProperty(parsed.program, "body", {
          configurable: true,
          enumerable: true,
          get: () => {
            programBodyReads++;
            return body;
          },
        });
        for (const node of nodes) {
          const nodeType = node.type;
          const parent = node.parent;
          Object.defineProperty(node, "type", {
            configurable: true,
            enumerable: true,
            get: () => {
              astTypeReads++;
              return nodeType;
            },
          });
          Object.defineProperty(node, "parent", {
            configurable: true,
            enumerable: false,
            get: () => {
              parentReads++;
              return parent;
            },
          });
        }
        const settings = {
          "react-doctor": {
            portedRuleMode: "curated",
            capabilities: ["react"],
            reactVersion: "18.3.1",
            reactMajorVersion: 18,
            jsxPropsNoSpreading: {
              html: "enforce",
              custom: "enforce",
              explicitSpread: "enforce",
              exceptions: [],
            },
          },
        };
        const context = {
          scopes,
          cfg,
          settings,
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
        expect(parsed.errors).toEqual([]);
        expect(spreads).toHaveLength(1);
        expect(
          spreads.map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
        ).toEqual([true]);
        expect(programBodyReads).toBeLessThanOrEqual(CSF2_PROGRAM_BODY_READ_LIMIT);
        expect(statementVisits).toBeLessThanOrEqual(statementCount * CSF2_PROGRAM_STATEMENT_PASSES);
        expect(parentReads).toBeLessThanOrEqual(nodes.length * CSF2_PARENT_READS_PER_NODE);
        expect(astTypeReads).toBeLessThanOrEqual(nodes.length * CSF2_AST_READS_PER_NODE);
        const options = {
          filename: "/synthetic/csf-work/preview.tsx",
          settings,
          includeLocations: true,
        };
        const actual = runRule(jsxPropsNoSpreading, code, options);
        const rejected = runRule(jsxPropsNoSpreading, rejectedCode, options);
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toHaveLength(0);
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(1);
      });
    }
  }
});
