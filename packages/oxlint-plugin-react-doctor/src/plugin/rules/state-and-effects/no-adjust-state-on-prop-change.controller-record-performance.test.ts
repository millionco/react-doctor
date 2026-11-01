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
  MAX_CONTROLLER_RECORD_PROGRAM_WALKS,
  MAX_CONTROLLER_RECORD_PROVIDER_REFERENCE_PASSES,
} from "../../../test-utils/controller-record-proof/constants.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isOwnedControllerRecordReset } from "./utils/is-owned-controller-record-reset.js";

const fixturePrefix =
  'import { useCallback, useEffect, useRef, useState } from "react";\ninterface PanelProps {\n  category: string;\n}\ninterface RequestEntry {\n  controller: AbortController;\n  attempt: number;\n}\nconst requestResource = async (signal: AbortSignal): Promise<string> =>\n  signal.aborted ? "stopped" : "ready";\n';
const fixtureComponent =
  'export const ResourcePanel = ({ category }: PanelProps) => {\n  const requests = useRef<Map<string, RequestEntry>>(new Map());\n  const counter = useRef(0);\n  const [busy, setBusy] = useState<Set<string>>(new Set());\n  const stopAll = useCallback(() => {\n    if (requests.current.size === 0) return;\n    requests.current.forEach(({ controller }) => controller.abort());\n    requests.current.clear();\n    setBusy(new Set());\n  }, []);\n  useEffect(() => {\n    stopAll();\n  }, [category, stopAll]);\n  useEffect(() => stopAll, [stopAll]);\n  const clearBusy = (resourceKey: string, attempt: number) => {\n    const active = requests.current.get(resourceKey);\n    if (!active || active.attempt !== attempt) return;\n    requests.current.delete(resourceKey);\n    setBusy((previous) => {\n      if (!previous.has(resourceKey)) return previous;\n      const next = new Set(previous);\n      next.delete(resourceKey);\n      return next;\n    });\n  };\n  const cancel = (resourceKey: string) => {\n    const active = requests.current.get(resourceKey);\n    if (!active) return;\n    const { controller, attempt } = active;\n    controller.abort();\n    clearBusy(resourceKey, attempt);\n  };\n  const start = async (resourceKey: string) => {\n    if (requests.current.has(resourceKey)) return;\n    const controller = new AbortController();\n    const attempt = ++counter.current;\n    requests.current.set(resourceKey, { controller, attempt });\n    setBusy((previous) => new Set(previous).add(resourceKey));\n    try {\n      await requestResource(controller.signal);\n      if (requests.current.get(resourceKey)?.attempt !== attempt) return;\n    } catch {\n      if (requests.current.get(resourceKey)?.attempt !== attempt) return;\n    } finally {\n      clearBusy(resourceKey, attempt);\n    }\n  };\n  return (\n    <button\n      onClick={() => {\n        if (busy.has("entry")) cancel("entry");\n        else void start("entry");\n      }}\n    >\n      {busy.has("entry") ? "Cancel" : "Start"}\n    </button>\n  );\n};\n';
const resetEffect = "  useEffect(() => {\n    stopAll();\n  }, [category, stopAll]);";

describe("owned controller record cold proof work", () => {
  for (const shape of ["shared-record-repeated-effects", "independent-record-components"]) {
    for (const count of CONTROLLER_RECORD_PROOF_COUNTS) {
      it(`${shape} at ${count} selected resets constructs stable proofs once`, () => {
        const source =
          fixturePrefix +
          (shape === "shared-record-repeated-effects"
            ? fixtureComponent.replace(
                resetEffect,
                Array.from({ length: count }, () => resetEffect).join("\n"),
              )
            : Array.from({ length: count }, (_, index) =>
                fixtureComponent.replace(
                  "export const ResourcePanel",
                  `export const ResourcePanel${index}`,
                ),
              ).join("\n"));
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a program");
        const program = parsed.program;
        const scopes = analyzeScopes(program);
        const writes: EsTreeNode[] = [];
        walkAst(program, (node) => {
          if (
            isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "setBusy" &&
            isNodeOfType(node.arguments[0], "NewExpression")
          )
            writes.push(node);
        });
        const firstWrite = writes[0];
        if (!firstWrite) throw new Error("Expected a selected reset");
        const selectedWrites =
          shape === "shared-record-repeated-effects"
            ? Array.from({ length: count }, () => firstWrite)
            : writes;
        expect(selectedWrites).toHaveLength(count);
        let programBodyReads = 0;
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
        const filename = `/synthetic/controller-record-work/${shape}-${count}.tsx`;
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
        expect(selectedWrites.every((write) => isOwnedControllerRecordReset(write, context))).toBe(
          true,
        );
        expect(programBodyReads).toBeLessThanOrEqual(MAX_CONTROLLER_RECORD_PROGRAM_WALKS);
        expect(providerReferenceVisits).toBeLessThanOrEqual(
          providerReferenceCount * MAX_CONTROLLER_RECORD_PROVIDER_REFERENCE_PASSES,
        );
        const result = runRule(noAdjustStateOnPropChange, source, { filename, settings });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        const escaped = runRule(
          noAdjustStateOnPropChange,
          source.replace(
            "const controller = new AbortController();",
            "const controller = new AbortController(); consume(controller);",
          ),
          { filename, settings },
        );
        expect(escaped.parseErrors).toEqual([]);
        expect(escaped.diagnostics).toHaveLength(
          shape === "shared-record-repeated-effects" ? count : 1,
        );
      });
    }
  }
});
