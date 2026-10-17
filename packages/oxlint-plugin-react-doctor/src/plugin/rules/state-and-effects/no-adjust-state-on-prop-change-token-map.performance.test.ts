import { describe, expect, it } from "vite-plus/test";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  CONTROLLER_RECORD_PROOF_COUNTS,
  MAX_CONTROLLER_RECORD_PROVIDER_REFERENCE_PASSES,
} from "../../../test-utils/controller-record-proof/constants.js";
import {
  MAX_TOKEN_MAP_PROGRAM_BODY_READS,
  MAX_TOKEN_MAP_AST_TYPE_READS_PER_NODE,
} from "../../../test-utils/token-map-proof/constants.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isOwnedControllerRecordReset } from "./utils/is-owned-controller-record-reset.js";

const fixturePrefix =
  'import { useEffect, useRef, useState } from "react";\ninterface PanelProps { category: string; }\nconst requestResource = async (signal: AbortSignal): Promise<string> => signal.aborted ? "stopped" : "ready";\n';
const fixtureBody =
  "\n  const tokens = useRef<Map<string, number>>(new Map());\n  const controllers = useRef<Map<string, AbortController>>(new Map());\n  const counter = useRef(0);\n  const [busy, setBusy] = useState<Record<string, number>>({});\n  const markBusy = (resourceKey: string, token: number) => {\n    tokens.current.set(resourceKey, token);\n    setBusy(previous => ({ ...previous, [resourceKey]: token }));\n  };\n  const clearBusy = (resourceKey: string) => {\n    tokens.current.delete(resourceKey);\n    controllers.current.delete(resourceKey);\n    setBusy(previous => { const next = { ...previous }; delete next[resourceKey]; return next; });\n  };\n  const isStale = (resourceKey: string, token: number) => tokens.current.get(resourceKey) !== token;\n  const stopAll = () => {\n    tokens.current.clear();\n    controllers.current.forEach(controller => controller.abort());\n    controllers.current.clear();\n    setBusy({});\n  };\n  useEffect(() => { stopAll(); }, [category]);\n  useEffect(() => () => { tokens.current.clear(); controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, []);\n  const start = async (resourceKey: string) => {\n    if (tokens.current.has(resourceKey)) return;\n    const token = ++counter.current;\n    const controller = new AbortController();\n    controllers.current.set(resourceKey, controller);\n    markBusy(resourceKey, token);\n    try {\n      await requestResource(controller.signal);\n      if (isStale(resourceKey, token)) return;\n      clearBusy(resourceKey);\n    } catch {\n      if (isStale(resourceKey, token)) return;\n      clearBusy(resourceKey);\n    }\n  };\n";

const registryNames = [
  "tokens",
  "controllers",
  "counter",
  "busy",
  "setBusy",
  "markBusy",
  "clearBusy",
  "isStale",
  "stopAll",
  "start",
];

describe("separate token and controller Map cold proof work", () => {
  for (const shape of ["independent-components", "independent-pairs-one-component"]) {
    for (const count of CONTROLLER_RECORD_PROOF_COUNTS) {
      it(`${shape} at ${count} selected resets constructs stable indexes once`, () => {
        const bodies = Array.from({ length: count }, (_, index) => {
          let body = fixtureBody;
          for (const name of registryNames)
            body = body.replace(new RegExp(`\\b${name}\\b`, "g"), `${name}${index}`);
          return body;
        });
        const buttons = Array.from(
          { length: count },
          (_, index) =>
            `<button onClick={()=>{void start${index}("entry");}}>{busy${index}.entry !== undefined ? "Working":"Start"}</button>`,
        );
        const source =
          fixturePrefix +
          (shape === "independent-components"
            ? Array.from(
                { length: count },
                (_, index) =>
                  `export const ResourcePanel${index} = ({ category }: PanelProps) => {${fixtureBody}return <button onClick={() => { void start("entry"); }}>{busy.entry !== undefined ? "Working" : "Start"}</button>;};`,
              ).join("\n")
            : `export const ResourcePanel=({category}:PanelProps)=>{${bodies.join("")}return <> ${buttons.join("")} </>;};`);
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const nodes: EsTreeNode[] = [];
        const writes: EsTreeNode[] = [];
        walkAst(program, (node) => {
          nodes.push(node);
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            /^setBusy\d*$/.test(node.callee.name) &&
            isNodeOfType(node.arguments[0], "ObjectExpression") &&
            node.arguments[0].properties.length === 0
          )
            writes.push(node);
        });
        expect(writes).toHaveLength(count);
        let programBodyReads = 0;
        let astTypeReads = 0;
        let providerReferenceVisits = 0;
        let providerReferenceCount = 0;
        for (const symbol of scopes.rootScope.symbols) {
          if (symbol.kind !== "import") continue;
          const references = symbol.references;
          providerReferenceCount += references.length;
          Object.defineProperty(symbol, "references", {
            configurable: true,
            value: new Proxy(references, {
              get(target, property, receiver) {
                if (typeof property === "string" && /^\d+$/.test(property))
                  providerReferenceVisits += 1;
                return Reflect.get(target, property, receiver);
              },
            }),
          });
        }
        const programBody = program.body;
        Object.defineProperty(program, "body", {
          configurable: true,
          enumerable: true,
          get() {
            programBodyReads += 1;
            return programBody;
          },
        });
        for (const node of nodes) {
          const nodeType = node.type;
          Object.defineProperty(node, "type", {
            configurable: true,
            enumerable: true,
            get() {
              astTypeReads += 1;
              return nodeType;
            },
          });
        }
        const filename = `/synthetic/token-map-proof/${shape}-${count}.tsx`;
        const settings = { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } };
        const context: RuleContext = {
          filename,
          scopes,
          get cfg() {
            return analyzeControlFlow(program);
          },
          settings,
          sourceCode: { ast: program, getText: () => source },
          report: () => {},
        };
        expect(writes.every((write) => isOwnedControllerRecordReset(write, context))).toBe(true);
        expect(programBodyReads).toBeLessThanOrEqual(MAX_TOKEN_MAP_PROGRAM_BODY_READS);
        expect(astTypeReads).toBeLessThanOrEqual(
          nodes.length * MAX_TOKEN_MAP_AST_TYPE_READS_PER_NODE,
        );
        expect(providerReferenceVisits).toBeLessThanOrEqual(
          providerReferenceCount * MAX_CONTROLLER_RECORD_PROVIDER_REFERENCE_PASSES,
        );
        const actual = runRule(noAdjustStateOnPropChange, source, { filename, settings });
        expect(actual.parseErrors).toEqual([]);
        expect(actual.diagnostics).toEqual([]);
        const rejectedSource =
          shape === "independent-components"
            ? source.replaceAll(
                "controllers.current.set(resourceKey, controller);",
                'controllers.current.set("wrong", controller);',
              )
            : source.replace(
                /(controllers\d+\.current\.set)\(resourceKey, controller\);/g,
                '$1("wrong", controller);',
              );
        const rejected = runRule(noAdjustStateOnPropChange, rejectedSource, { filename, settings });
        expect(rejected.parseErrors).toEqual([]);
        expect(rejected.diagnostics).toHaveLength(count);
      });
    }
  }
});
