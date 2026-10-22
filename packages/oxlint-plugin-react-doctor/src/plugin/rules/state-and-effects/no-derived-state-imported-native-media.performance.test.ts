import * as astWalking from "../../utils/walk-ast.js";
import {
  NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
  NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
  NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
} from "./utils/effect/constants.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import {
  IMPORTED_MEDIA_PROOF_WRITE_COUNTS,
  MAX_IMPORTED_MEDIA_ROOT_SYMBOL_PASSES,
  MAX_IMPORTED_MEDIA_HELPER_REFERENCE_PASSES,
  MAX_IMPORTED_MEDIA_EXPORTER_PROGRAM_PASSES,
  MAX_NATIVE_MEDIA_PROGRAM_PROOF_PASSES,
  NATIVE_MEDIA_CACHE_KEY_COMPONENT_COUNT,
} from "../../../test-utils/imported-media-proof/constants.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseSourceFile } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noDerivedState } from "./no-derived-state.js";
import { createImportedNativeMediaGuardPredicate } from "./utils/create-imported-native-media-guard-predicate.js";
import { createNativeMediaCapabilityPredicate } from "./utils/create-native-media-capability-predicate.js";

describe("imported media proof work", () => {
  it.each(
    [false, true].flatMap((recordDependencies) =>
      ["same-imported-guard", "distinct-imported-guards", "no-imported-helper"].flatMap((shape) =>
        IMPORTED_MEDIA_PROOF_WRITE_COUNTS.map((count) => ({ shape, count, recordDependencies })),
      ),
    ),
  )(
    "bounds cold work for $shape with $count writes and recording=$recordDependencies",
    ({ shape, count, recordDependencies }) => {
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
        const selectedEffectFunction = effectFunction;
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
          const createPredicate = () =>
            createImportedNativeMediaGuardPredicate({
              context,
              effectFunction: selectedEffectFunction,
              executionNode,
            });
          const capture = recordDependencies ? captureCrossFileProbes(createPredicate) : null;
          const predicate = capture ? capture.value : createPredicate();
          if (capture && moduleCount > 0) {
            for (const helperPath of helperPaths)
              expect(capture.trace.contentPaths.has(helperPath)).toBe(true);
          }
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
            code.replace(
              "export const Example",
              "const escaped=supportsClip0;export const Example",
            ),
            { filename },
          );
          expect(escaped.parseErrors).toEqual([]);
          expect(escaped.diagnostics).toHaveLength(moduleCount === 1 ? count : 1);
        }
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

interface NativeMediaProofCall {
  stateDeclarator: EsTreeNode;
  effectNode: EsTreeNode;
  effectFunction: EsTreeNode;
  executionNode: EsTreeNode;
  test: EsTreeNode;
}

interface NativeMediaProofFixture {
  program: EsTreeNode;
  context: RuleContext;
  calls: NativeMediaProofCall[];
}

interface NativeMediaProofSourceInput {
  componentCount: number;
  defaultImport?: boolean;
  firstStateApi?: "useState" | "useReducer";
  prefix?: string;
}

const createNativeMediaProofSource = ({
  componentCount,
  defaultImport = false,
  firstStateApi = "useState",
  prefix = "",
}: NativeMediaProofSourceInput): string => {
  const imports = defaultImport
    ? 'import React from "react";'
    : 'import { useEffect, useState } from "react";';
  const qualifier = defaultImport ? "React." : "";
  const components = Array.from({ length: componentCount }, (_, index) => {
    const stateApi = index === 0 ? firstStateApi : "useState";
    const initializer =
      stateApi === "useReducer"
        ? "((_current: string | null) => null, null)"
        : "<string | null>(null)";
    return `
export const Example${index} = ({ mime, source }: { mime: string; source: string }) => {
  const [selected${index}, setSelected${index}] = ${qualifier}${stateApi}${initializer};
  ${qualifier}useEffect(() => {
    if (document.createElement("video").canPlayType(mime) !== "") setSelected${index}(source);
  }, [mime, source]);
  return <video data-selected={selected${index} === source} />;
};`;
  }).join("\n");
  return `${imports}\n${prefix}\n${components}\n`;
};

const createNativeMediaProofFixture = (code: string): NativeMediaProofFixture => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const stateDeclarators: EsTreeNode[] = [];
  const effectNodes: EsTreeNode[] = [];
  const effectFunctions: EsTreeNode[] = [];
  const executions: EsTreeNode[] = [];
  const tests: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "ArrayPattern"))
      stateDeclarators.push(node);
    if (isNodeOfType(node, "IfStatement")) tests.push(node.test);
    if (!isNodeOfType(node, "CallExpression")) return;
    if (isNodeOfType(node.callee, "Identifier") && node.callee.name.startsWith("setSelected"))
      executions.push(node);
    const calleeName = isNodeOfType(node.callee, "Identifier")
      ? node.callee.name
      : isNodeOfType(node.callee, "MemberExpression")
        ? getStaticPropertyName(node.callee)
        : null;
    if (calleeName !== "useEffect") return;
    const effectFunction = node.arguments[0];
    if (!effectFunction || !isNodeOfType(effectFunction, "ArrowFunctionExpression"))
      throw new Error("Expected the controlled native effect");
    effectNodes.push(node);
    effectFunctions.push(effectFunction);
  });
  expect(effectNodes).toHaveLength(stateDeclarators.length);
  expect(effectFunctions).toHaveLength(stateDeclarators.length);
  expect(executions).toHaveLength(stateDeclarators.length);
  expect(tests).toHaveLength(stateDeclarators.length);
  const calls = stateDeclarators.map((stateDeclarator, index) => {
    const effectNode = effectNodes[index];
    const effectFunction = effectFunctions[index];
    const executionNode = executions[index];
    const test = tests[index];
    if (!effectNode || !effectFunction || !executionNode || !test)
      throw new Error("Expected a complete native proof fixture");
    return { stateDeclarator, effectNode, effectFunction, executionNode, test };
  });
  return {
    program: parsed.program,
    calls,
    context: {
      scopes,
      cfg: analyzeControlFlow(parsed.program),
      filename: "native-media.tsx",
      sourceCode: { ast: parsed.program, getText: () => code },
      report: () => {},
    },
  };
};

describe("native media provider proof work", () => {
  it.each(
    IMPORTED_MEDIA_PROOF_WRITE_COUNTS.flatMap((count) =>
      [false, true].map((hasProviderHazard) => ({ count, hasProviderHazard })),
    ),
  )(
    "bounds whole-program work for $count effects and hazard=$hasProviderHazard",
    ({ count, hasProviderHazard }) => {
      const fixture = createNativeMediaProofFixture(
        createNativeMediaProofSource({
          componentCount: count,
          prefix: hasProviderHazard ? "const unusedFactory = document.createElement;" : "",
        }),
      );
      expect(fixture.calls).toHaveLength(count);
      if (!isNodeOfType(fixture.program, "Program")) throw new Error("Expected a native importer");
      const body = fixture.program.body;
      let programReads = 0;
      Object.defineProperty(fixture.program, "body", {
        get: () => {
          programReads += 1;
          return body;
        },
      });
      for (const { test, ...input } of fixture.calls) {
        const predicate = createNativeMediaCapabilityPredicate({
          context: fixture.context,
          ...input,
        });
        expect(Boolean(predicate?.(test))).toBe(!hasProviderHazard);
      }
      expect(programReads).toBeGreaterThan(0);
      expect(programReads).toBeLessThanOrEqual(MAX_NATIVE_MEDIA_PROGRAM_PROOF_PASSES);
    },
  );

  it("keeps invalid API calls separate from a canonical call on the same default import", () => {
    const fixture = createNativeMediaProofFixture(
      createNativeMediaProofSource({
        componentCount: NATIVE_MEDIA_CACHE_KEY_COMPONENT_COUNT,
        defaultImport: true,
        firstStateApi: "useReducer",
      }),
    );
    const results = fixture.calls.map(({ test, ...input }) =>
      Boolean(createNativeMediaCapabilityPredicate({ context: fixture.context, ...input })?.(test)),
    );
    expect(results).toEqual([false, true]);
  });

  it("keeps useEffect provider rejection separate from useState on one default import", () => {
    const fixture = createNativeMediaProofFixture(
      createNativeMediaProofSource({
        componentCount: NATIVE_MEDIA_CACHE_KEY_COMPONENT_COUNT,
        defaultImport: true,
        prefix: "const escapedEffect = React.useEffect; void escapedEffect;",
      }),
    );
    for (const { test, ...input } of fixture.calls)
      expect(
        createNativeMediaCapabilityPredicate({ context: fixture.context, ...input })?.(test),
      ).toBeUndefined();
  });

  it("keeps syntax proofs isolated across analyses at the same filename", () => {
    const ordinary = createNativeMediaProofFixture(
      createNativeMediaProofSource({ componentCount: NATIVE_MEDIA_CACHE_KEY_COMPONENT_COUNT }),
    );
    const hazardous = createNativeMediaProofFixture(
      createNativeMediaProofSource({
        componentCount: NATIVE_MEDIA_CACHE_KEY_COMPONENT_COUNT,
        prefix: "const unusedFactory = document.createElement;",
      }),
    );
    for (const fixture of [ordinary, hazardous, ordinary]) {
      for (const { test, ...input } of fixture.calls)
        expect(
          Boolean(
            createNativeMediaCapabilityPredicate({ context: fixture.context, ...input })?.(test),
          ),
        ).toBe(fixture === ordinary);
    }
  });
});

for (const distinctProviders of [false, true]) {
  it(`bounds recorded effect traversals across repeated state writes with distinct providers ${distinctProviders}`, () => {
    const countVisits = (writeCount: number): number => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recorded-imported-media-work-"));
      try {
        const providerCount = distinctProviders ? writeCount : 1;
        const imports = Array.from({ length: providerCount }, (_, index) => {
          fs.writeFileSync(
            path.join(directory, `capability-${index}.ts`),
            `export const supportsClip${index}=(mime:string)=>document.createElement('video').canPlayType(mime)!=='';`,
          );
          return `import{supportsClip${index}}from'./capability-${index}';`;
        }).join("");
        const writes = Array.from(
          { length: writeCount },
          (_, index) =>
            `if(supportsClip${distinctProviders ? index : 0}(mime))setSelected(source);`,
        ).join("");
        const code = `import{useEffect,useState}from'react';${imports}export const Example=({mime,source}:{mime:string;source:string})=>{const[selected,setSelected]=useState<string|null>(null);useEffect(()=>{${writes}},[mime,source]);return <video data-selected={selected===source}/>};`;
        const filename = path.join(directory, "consumer.tsx");
        fs.writeFileSync(filename, code);
        const parsed = parseFixture(code);
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        let effectFunction: EsTreeNode | null = null;
        const executions: EsTreeNode[] = [];
        const conditions: EsTreeNode[] = [];
        walkAst(parsed.program, (node) => {
          if (isNodeOfType(node, "IfStatement")) conditions.push(node.test);
          if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "Identifier"))
            return;
          if (node.callee.name === "setSelected") executions.push(node);
          const callback = node.arguments[0];
          if (
            node.callee.name === "useEffect" &&
            callback &&
            isNodeOfType(callback, "ArrowFunctionExpression")
          )
            effectFunction = callback;
        });
        if (!effectFunction) throw new Error("Expected the controlled effect");
        const selectedEffect = effectFunction;
        const context: RuleContext = {
          scopes,
          cfg: analyzeControlFlow(parsed.program),
          filename,
          sourceCode: { ast: parsed.program, getText: () => code },
          report: () => {},
        };
        let visits = 0;
        const originalWalk = astWalking.walkAst;
        const traversal = vi.spyOn(astWalking, "walkAst").mockImplementation((node, visitor) =>
          originalWalk(node, (candidate) => {
            visits++;
            return visitor(candidate);
          }),
        );
        try {
          for (const [index, executionNode] of executions.entries()) {
            const proof = captureCrossFileProbes(() =>
              createImportedNativeMediaGuardPredicate({
                context,
                effectFunction: selectedEffect,
                executionNode,
              }),
            );
            const condition = conditions[index];
            if (!condition) throw new Error("Expected the matching condition");
            expect(proof.value?.(condition)).toBe(true);
          }
        } finally {
          traversal.mockRestore();
        }
        return visits;
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };
    const small = countVisits(NATIVE_MEDIA_SMALL_COMPONENT_COUNT);
    const large = countVisits(NATIVE_MEDIA_LARGE_COMPONENT_COUNT);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeLessThan(small * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER);
  });
}
