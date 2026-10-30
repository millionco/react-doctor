import { describe, expect, it } from "vite-plus/test";
import { runRule, runRuleOnParsedFixture } from "../../../../test-utils/run-rule.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import type { ParseFixtureResult } from "../../../../test-utils/parse-fixture.js";
import type { Rule } from "../../../utils/rule.js";
import type { ScopeAnalysis, ScopeDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getRef } from "./effect/ast.js";
import { getProgramAnalysis } from "./effect/get-program-analysis.js";
import { getDirectMotionResourceLifecycleTag } from "./get-direct-motion-resource-lifecycle-tag.js";

interface ProviderProbeResult {
  providerScans: number;
  tags: (string | null)[];
}

const probeProviders = (
  code: string,
  candidateCount: number,
  wrapScopes: (scopes: ScopeAnalysis) => ScopeAnalysis = (scopes) => scopes,
  parsed?: ParseFixtureResult,
): ProviderProbeResult => {
  let providerScans = 0;
  const tags: (string | null)[] = [];
  const effects: EsTreeNode[] = [];
  const rule: Rule = {
    id: "motion-resource-provider-probe",
    severity: "warn",
    create: (context) => {
      const originalScopes = context.scopes;
      const originalRoot = originalScopes.rootScope;
      const rootScope: ScopeDescriptor = {
        ...originalRoot,
        get symbols() {
          providerScans += 1;
          return originalRoot.symbols;
        },
      };
      const scopes = wrapScopes({ ...originalScopes, rootScope });
      const proofContext = { ...context, scopes };
      return {
        CallExpression: (node: EsTreeNodeOfType<"CallExpression">) => {
          if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "useEffect") {
            effects.push(node);
          }
        },
        JSXOpeningElement: (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
          const attribute = node.attributes.find(
            (candidate) =>
              isNodeOfType(candidate, "JSXAttribute") &&
              isNodeOfType(candidate.name, "JSXIdentifier") &&
              candidate.name.name === "onError",
          );
          if (!attribute) return;
          for (const effectNode of effects) {
            if (!isNodeOfType(effectNode, "CallExpression")) continue;
            const callback = effectNode.arguments[0];
            if (!isNodeOfType(callback, "ArrowFunctionExpression")) continue;
            if (!isNodeOfType(callback.body, "CallExpression")) continue;
            const analysis = getProgramAnalysis(effectNode);
            if (!analysis) continue;
            const setterReference = getRef(analysis, callback.body.callee);
            if (!setterReference) continue;
            for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
              tags.push(
                getDirectMotionResourceLifecycleTag({
                  analysis,
                  attribute,
                  context: proofContext,
                  effectNode,
                  matchesFailureLatchWriter: () => true,
                  setterReference,
                }),
              );
            }
          }
        },
      };
    },
  };
  const result = parsed ? runRuleOnParsedFixture(rule, code, parsed) : runRule(rule, code);
  expect(result.parseErrors).toEqual([]);
  return { providerScans, tags };
};

const resourceSource = `import {useEffect,useState} from "react";
import {motion} from "framer-motion";
export const ResourceProbe=({resourceUrl,otherUrl})=>{
  const [didFail,setDidFail]=useState(false);
  useEffect(()=>setDidFail(false),[resourceUrl]);
  return <motion.video src={resourceUrl} onError={()=>setDidFail(true)}/>;
};`;

describe("direct Motion resource provider cache", () => {
  it.each([1, 8])("discovers providers once for %i candidates", (candidateCount) => {
    const result = probeProviders(resourceSource, candidateCount);
    expect(result.providerScans).toBe(1);
    expect(result.tags).toEqual(Array.from({ length: candidateCount }, () => "video"));
  });

  it("isolates separate scope analyses of the same program", () => {
    const parsed = parseFixture(resourceSource);
    expect(probeProviders(resourceSource, 1, undefined, parsed)).toEqual({
      providerScans: 1,
      tags: ["video"],
    });
    expect(probeProviders(resourceSource, 1, undefined, parsed)).toEqual({
      providerScans: 1,
      tags: ["video"],
    });
  });

  it("checks distinct providers and effects without sharing dependency eligibility", () => {
    const source = resourceSource
      .replace(
        'import {motion} from "framer-motion";',
        'import {motion} from "framer-motion"; import {motion as otherMotion} from "motion/react";',
      )
      .replace(
        "return <motion.video",
        "useEffect(()=>setDidFail(false),[otherUrl]); const decoration=<otherMotion.div/>; return <motion.video",
      );
    const result = probeProviders(source, 1);
    expect(result.providerScans).toBe(1);
    expect(result.tags).toEqual(["video", null]);
  });

  it("isolates programs even when a host reuses its scope wrapper", () => {
    let currentScopes: ScopeAnalysis | null = null;
    const getScopes = (): ScopeAnalysis => {
      if (!currentScopes) throw new Error("Scope probe is not initialized");
      return currentScopes;
    };
    const sharedScopes: ScopeAnalysis = {
      get rootScope() {
        return getScopes().rootScope;
      },
      scopeFor: (node) => getScopes().scopeFor(node),
      ownScopeFor: (node) => getScopes().ownScopeFor(node),
      symbolFor: (node) => getScopes().symbolFor(node),
      referenceFor: (node) => getScopes().referenceFor(node),
      isGlobalReference: (node) => getScopes().isGlobalReference(node),
    };
    const wrapScopes = (scopes: ScopeAnalysis): ScopeAnalysis => {
      currentScopes = scopes;
      return sharedScopes;
    };
    expect(probeProviders(resourceSource, 1, wrapScopes).tags).toEqual(["video"]);
    expect(
      probeProviders(`${resourceSource}\nmotion.video=replacementVideo;`, 1, wrapScopes).tags,
    ).toEqual([null]);
    expect(probeProviders(resourceSource, 1, wrapScopes).tags).toEqual(["video"]);
    expect(probeProviders(resourceSource, 1).providerScans).toBe(1);
  });
});
