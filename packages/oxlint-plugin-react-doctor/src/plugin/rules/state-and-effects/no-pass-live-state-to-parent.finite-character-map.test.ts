import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFuzzCorpus } from "../../../../../fuzz/src/load-fuzz-corpus.js";
import { EFFECT_SNIPPET_POOL } from "../../../../../fuzz/src/snippet-pools.js";
import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isTemplateGetterResultConsumedByLocalStateSetter } from "./utils/is-template-getter-result-consumed-by-local-state-setter.js";

interface GetterConditionCase {
  name: string;
  condition: string;
  supported: boolean;
}

const cases: GetterConditionCase[] = [
  {
    name: "readonly conjunction",
    condition: 'value && typeof value === "object" && "label" in value',
    supported: true,
  },
  {
    name: "nested conjunction",
    condition: '(value !== null && typeof value === "object") && "label" in value',
    supported: true,
  },
  { name: "disjunction", condition: 'value || typeof value === "object"', supported: false },
  { name: "nullish condition", condition: "value ?? fallback", supported: false },
  { name: "opaque call", condition: "value && inspect(value)", supported: false },
  { name: "assignment", condition: "(value = replacement) && value", supported: false },
  { name: "update", condition: "value++ && enabled", supported: false },
  { name: "computed data read", condition: "value && value[key]", supported: false },
];

const createSource = (condition: string): string => `
import {useCallback,useEffect,useState} from "react";
export const Status = ({initial, getLabel}) => {
  const [selected,setSelected] = useState(initial);
  const [status,setStatus] = useState("");
  const label = useCallback(value => (${condition}) ? getLabel(value) : value, [getLabel]);
  useEffect(() => {setStatus(\`\${label(selected)} chosen\`);}, [selected,label]);
  return <button onClick={() => setSelected("next")}>{status}</button>;
};`;

describe("readonly conjunction getter condition", () => {
  it.each(cases)("checks the exact getter boundary: $name", ({ condition, supported }) => {
    const source = createSource(condition);
    const fixture = parseFixture(source);
    expect(fixture.errors).toEqual([]);
    attachParentReferences(fixture.program);
    const scopes = analyzeScopes(fixture.program);
    const analysis = getProgramAnalysis(fixture.program);
    expect(analysis).not.toBeNull();
    if (!analysis) throw new Error("Expected program analysis");
    const calls: EsTreeNode[] = [];
    walkAst(fixture.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "label"
      )
        calls.push(node);
    });
    expect(calls).toHaveLength(1);
    expect(
      calls.map((call) => isTemplateGetterResultConsumedByLocalStateSetter(call, analysis, scopes)),
    ).toEqual([supported]);
    if (supported) {
      const result = runRule(noPassLiveStateToParent, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});

interface FiniteGetterCorpusCase {
  fixtureName: string;
  verdict: "pass" | "fail";
  expected: number;
}

const finiteGetterCorpusCases: FiniteGetterCorpusCase[] = [
  { fixtureName: "finite-character-map-status-getter", verdict: "pass", expected: 0 },
  { fixtureName: "finite-character-map-bare-notification", verdict: "fail", expected: 1 },
];

const finiteGetterReactImport =
  'import { useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer, useTransition, useDeferredValue, useId, useLayoutEffect, useSyncExternalStore } from "react";';

describe("finite character-map fuzz transport", () => {
  it.each(finiteGetterCorpusCases)(
    "loads and preserves $fixtureName",
    ({ fixtureName, verdict, expected }) => {
      const relativePath = `regressions/no-pass-live-state-to-parent--${fixtureName}.tsx`;
      const corpus = loadFuzzCorpus(
        fileURLToPath(new URL("../../../../../fuzz/corpus/", import.meta.url)),
        { maximumFiles: Number.POSITIVE_INFINITY },
      );
      const entry = corpus.find((candidate) => candidate.relativePath === relativePath);
      expect(entry).toBeDefined();
      if (!entry) throw new Error("Expected finite character-map corpus fixture");
      expect(entry.ruleIds).toEqual(["no-pass-live-state-to-parent"]);
      expect(entry.verdict).toBe(verdict);
      expect(entry.code).toBe(
        readFileSync(
          new URL(`../../../../../fuzz/corpus/${relativePath}`, import.meta.url),
          "utf8",
        ),
      );
      const result = runRule(noPassLiveStateToParent, entry.code, { filename: entry.relativePath });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it("keeps exactly the separate notification in the pool block", () => {
    const snippet = EFFECT_SNIPPET_POOL.find((entry) =>
      entry.includes("FuzzFiniteCharacterMapStatusGetter"),
    );
    expect(snippet).toBeDefined();
    if (!snippet) throw new Error("Expected finite character-map generator block");
    const source = `${finiteGetterReactImport} const handle = value => value; ${snippet}`;
    const result = runRule(noPassLiveStateToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    const consumedOnly = runRule(
      noPassLiveStateToParent,
      source.replace("getLabel(selection);", ""),
    );
    expect(consumedOnly.parseErrors).toEqual([]);
    expect(consumedOnly.diagnostics).toEqual([]);
  });
});
