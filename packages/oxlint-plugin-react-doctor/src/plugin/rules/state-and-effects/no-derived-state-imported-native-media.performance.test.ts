import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import {
  IMPORTED_MEDIA_PROOF_WRITE_COUNTS,
  MAX_IMPORTED_MEDIA_ROOT_SYMBOL_PASSES,
  MAX_IMPORTED_MEDIA_HELPER_REFERENCE_PASSES,
  MAX_IMPORTED_MEDIA_EXPORTER_PROGRAM_PASSES,
} from "../../../test-utils/imported-media-proof/constants.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noDerivedState } from "./no-derived-state.js";
import { createImportedNativeMediaGuardPredicate } from "./utils/create-imported-native-media-guard-predicate.js";

describe("imported media proof work", () => {
  it.each(
    ["same-imported-guard", "distinct-imported-guards", "no-imported-helper"].flatMap((shape) =>
      IMPORTED_MEDIA_PROOF_WRITE_COUNTS.map((count) => ({ shape, count })),
    ),
  )("bounds cold work for $shape with $count writes", ({ shape, count }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-media-work-"));
    try {
      let moduleCount = 0;
      if (shape === "same-imported-guard") moduleCount = 1;
      else if (shape === "distinct-imported-guards") moduleCount = count;
      const helperPaths: string[] = [];
      const imports = Array.from({ length: moduleCount }, (_, index) => {
        const helperPath = path.join(directory, `capability-${index}.ts`);
        fs.writeFileSync(
          helperPath,
          `export const supportsClip${index}=(mime:string)=>document.createElement('video').canPlayType(mime)!=='';`,
        );
        helperPaths.push(helperPath);
        return `import{supportsClip${index}}from'./capability-${index}';`;
      }).join("");
      const writes = Array.from({ length: count }, (_, index) => {
        const guard =
          shape === "no-imported-helper"
            ? "mime"
            : `supportsClip${shape === "same-imported-guard" ? 0 : index}(mime)`;
        return `if(${guard})setSelected(source);`;
      }).join("");
      const code = `import{useEffect,useState}from'react';${imports}export const Example=({mime,source}:{mime:string;source:string})=>{const[selected,setSelected]=useState<string|null>(null);useEffect(()=>{${writes}},[mime,source]);return <video data-selected={selected===source}/>};`;
      const filename = path.join(directory, "consumer.tsx");
      fs.writeFileSync(filename, code);
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const symbols = new Set<SymbolDescriptor>();
      const executions: EsTreeNode[] = [];
      const tests: EsTreeNode[] = [];
      let effectFunction: EsTreeNode | null = null;
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "Identifier")) {
          const symbol = scopes.symbolFor(node);
          if (symbol) symbols.add(symbol);
        }
        if (isNodeOfType(node, "IfStatement")) tests.push(node.test);
        if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier"))
          return;
        if (node.callee.name === "setSelected") executions.push(node);
        const effect = node.arguments[0];
        if (
          node.callee.name === "useEffect" &&
          effect &&
          isNodeOfType(effect, "ArrowFunctionExpression")
        )
          effectFunction = effect;
      });
      if (!effectFunction) throw new Error("Expected the controlled effect fixture");
      const context: RuleContext = {
        scopes,
        cfg: analyzeControlFlow(parsed.program),
        filename,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        sourceCode: { ast: parsed.program, getText: () => code },
        report: () => {},
      };
      let helperReferenceVisits = 0;
      for (const symbol of symbols) {
        if (!symbol.name.startsWith("supportsClip")) continue;
        Object.defineProperty(symbol, "references", {
          value: new Proxy(symbol.references, {
            get: (references, property, receiver) => {
              if (typeof property === "string" && /^\d+$/.test(property))
                helperReferenceVisits += 1;
              return Reflect.get(references, property, receiver);
            },
          }),
        });
      }
      const rootSymbolCount = scopes.rootScope.symbols.length;
      let rootSymbolVisits = 0;
      Object.defineProperty(scopes.rootScope, "symbols", {
        value: new Proxy(scopes.rootScope.symbols, {
          get: (symbols, property, receiver) => {
            if (typeof property === "string" && /^\d+$/.test(property)) rootSymbolVisits += 1;
            return Reflect.get(symbols, property, receiver);
          },
        }),
      });
      let importerProgramReads = 0;
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected a parsed importer");
      const importerBody = parsed.program.body;
      Object.defineProperty(parsed.program, "body", {
        get: () => {
          importerProgramReads += 1;
          return importerBody;
        },
      });
      let exporterProgramReads = 0;
      for (const helperPath of helperPaths) {
        const program = parseSourceFile(helperPath);
        if (!program || !isNodeOfType(program, "Program"))
          throw new Error("Expected a parse-clean selected helper");
        const body = program.body;
        Object.defineProperty(program, "body", {
          get: () => {
            exporterProgramReads += 1;
            return body;
          },
        });
      }
      expect(executions).toHaveLength(count);
      for (const [index, executionNode] of executions.entries()) {
        const predicate = createImportedNativeMediaGuardPredicate({
          context,
          effectFunction,
          executionNode,
        });
        const test = tests[index];
        const firstTest = tests[0];
        if (!test || !firstTest) throw new Error("Expected each controlled branch test");
        expect(Boolean(predicate?.(test))).toBe(moduleCount > 0);
        if (index > 0 && moduleCount > 0) expect(predicate?.(firstTest)).toBe(false);
      }
      expect(importerProgramReads).toBe(moduleCount > 0 ? 1 : 0);
      expect(rootSymbolVisits).toBeLessThanOrEqual(
        rootSymbolCount * MAX_IMPORTED_MEDIA_ROOT_SYMBOL_PASSES,
      );
      expect(helperReferenceVisits).toBeLessThanOrEqual(
        count * MAX_IMPORTED_MEDIA_HELPER_REFERENCE_PASSES,
      );
      expect(exporterProgramReads).toBeLessThanOrEqual(
        moduleCount * MAX_IMPORTED_MEDIA_EXPORTER_PROGRAM_PASSES,
      );
      if (moduleCount > 0) expect(exporterProgramReads).toBeGreaterThan(0);
      const result = runRule(noDerivedState, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(moduleCount > 0 ? 0 : count);
      if (moduleCount > 0) {
        const escaped = runRule(
          noDerivedState,
          code.replace("export const Example", "const escaped=supportsClip0;export const Example"),
          { filename },
        );
        expect(escaped.parseErrors).toEqual([]);
        expect(escaped.diagnostics).toHaveLength(moduleCount === 1 ? count : 1);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
