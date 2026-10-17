import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noDerivedState } from "./no-derived-state.js";
import { isClosedNativeMediaRefSnapshot } from "./utils/is-closed-native-media-ref-snapshot.js";

import {
  MAX_NATIVE_MEDIA_PROVIDER_REFERENCE_PASSES,
  MAX_NATIVE_MEDIA_OWNERSHIP_REFERENCE_PASSES,
} from "../../../test-utils/native-media-ref-proof/constants.js";

describe("owned media snapshot proof work", () => {
  it.each([
    { shape: "one-shared-snapshot", count: 20 },
    { shape: "one-shared-snapshot", count: 100 },
    { shape: "distinct-ref-snapshot-pairs", count: 20 },
    { shape: "distinct-ref-snapshot-pairs", count: 100 },
  ])("bounds cold proof work for $shape with $count writes", ({ shape, count }) => {
    const pairCount = shape === "one-shared-snapshot" ? 1 : count;
    const declarations = Array.from(
      { length: pairCount },
      (_, index) => `const mediaRef${index}=useRef<HTMLVideoElement|null>(null);`,
    ).join("");
    const snapshots = Array.from(
      { length: pairCount },
      (_, index) =>
        `if(!mediaRef${index}.current)return;const media${index}=mediaRef${index}.current;`,
    ).join("");
    const writes = Array.from(
      { length: count },
      (_, index) =>
        `if(media${shape === "one-shared-snapshot" ? 0 : index}.canPlayType(mime)==='')setFailedKey(mediaKey);`,
    ).join("");
    const videos = Array.from(
      { length: pairCount },
      (_, index) => `<video ref={mediaRef${index}}/>`,
    ).join("");
    const code = `import{useEffect,useRef,useState}from'react';export const Example=({mime,mediaKey}:{mime:string;mediaKey:string})=>{const[failedKey,setFailedKey]=useState<string|null>(null);${declarations}useEffect(()=>{${snapshots}${writes}},[mime,mediaKey]);return <>{failedKey===mediaKey?null:<>${videos}</>}</>};`;
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Missing synthetic program");
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const symbols = new Set<SymbolDescriptor>();
    const receivers: EsTreeNode[] = [];
    let effectFunction: EsTreeNode | null = null;
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "Identifier")) {
        const symbol = scopes.symbolFor(node);
        if (symbol) symbols.add(symbol);
      }
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "useEffect"
      ) {
        const effect = node.arguments[0];
        if (effect && isNodeOfType(effect, "ArrowFunctionExpression")) effectFunction = effect;
      }
      if (
        isNodeOfType(node, "MemberExpression") &&
        isNodeOfType(node.property, "Identifier") &&
        node.property.name === "canPlayType"
      )
        receivers.push(node.object);
    });
    if (!effectFunction) throw new Error("Expected the controlled effect fixture");
    const context: RuleContext = {
      scopes,
      cfg: analyzeControlFlow(parsed.program),
      filename: "src/components/media-proof.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      sourceCode: { ast: parsed.program, getText: () => code },
      report: () => undefined,
    };
    let providerReferenceCount = 0;
    let providerReferenceVisits = 0;
    let refReferenceCount = 0;
    let refReferenceVisits = 0;
    let snapshotReferenceCount = 0;
    let snapshotReferenceVisits = 0;
    for (const symbol of symbols) {
      if (symbol.kind === "import") providerReferenceCount += symbol.references.length;
      else if (symbol.name.startsWith("mediaRef")) refReferenceCount += symbol.references.length;
      else if (/^media\d+$/.test(symbol.name)) snapshotReferenceCount += symbol.references.length;
      Object.defineProperty(symbol, "references", {
        value: new Proxy(symbol.references, {
          get: (references, property, receiver) => {
            if (typeof property === "string" && /^\d+$/.test(property)) {
              if (symbol.kind === "import") providerReferenceVisits += 1;
              else if (symbol.name.startsWith("mediaRef")) refReferenceVisits += 1;
              else if (/^media\d+$/.test(symbol.name)) snapshotReferenceVisits += 1;
            }
            return Reflect.get(references, property, receiver);
          },
        }),
      });
    }
    let programBodyReads = 0;
    const programBody = parsed.program.body;
    Object.defineProperty(parsed.program, "body", {
      get: () => {
        programBodyReads += 1;
        return programBody;
      },
    });
    expect(receivers).toHaveLength(count);
    for (const expression of receivers)
      expect(isClosedNativeMediaRefSnapshot({ expression, effectFunction, context })).toBe(true);
    expect(programBodyReads).toBe(1);
    expect(providerReferenceVisits).toBeLessThanOrEqual(
      providerReferenceCount * MAX_NATIVE_MEDIA_PROVIDER_REFERENCE_PASSES,
    );
    expect(refReferenceVisits).toBeLessThanOrEqual(
      refReferenceCount * MAX_NATIVE_MEDIA_OWNERSHIP_REFERENCE_PASSES,
    );
    expect(snapshotReferenceVisits).toBeLessThanOrEqual(
      snapshotReferenceCount * MAX_NATIVE_MEDIA_OWNERSHIP_REFERENCE_PASSES,
    );
    for (const [source, expected] of [
      [code, 0],
      [code.replace("export const Example", "const escape=useRef;export const Example"), count],
      [code.replace(snapshots, `${snapshots}consume(media0);`), pairCount === 1 ? count : 1],
    ] satisfies ReadonlyArray<readonly [string, number]>) {
      const result = runRule(noDerivedState, source, { filename: context.filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    }
  });
});
