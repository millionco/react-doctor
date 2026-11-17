import { describe, expect, it, vi } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import {
  ERROR_PROSE_LITERAL_LOOKUP_OVERHEAD_READ_COUNT,
  ERROR_PROSE_WORK_LARGE_RECORD_COUNT,
  ERROR_PROSE_WORK_SMALL_RECORD_COUNT,
} from "../../constants/thresholds.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { insecureCryptoRisk } from "./insecure-crypto-risk.js";

const literalWork = vi.hoisted(() => ({
  nodeStartReads: 0,
  rootStatementVisits: 0,
  rootSymbolVisits: 0,
}));

vi.mock("../../semantic/scope-analysis.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../semantic/scope-analysis.js")>();
  return {
    ...originalModule,
    analyzeScopes: (program: EsTreeNode) => {
      const analysis = originalModule.analyzeScopes(program);
      const owner = analysis.rootScope.node;
      if (owner.type !== "Program") throw new Error("Expected program scope");
      const statements = owner.body;
      const originalSome = statements.some.bind(statements);
      Object.defineProperty(statements, "some", {
        configurable: true,
        value: (predicate: Parameters<typeof statements.some>[0]) =>
          originalSome((statement, index, array) => {
            literalWork.rootStatementVisits += 1;
            return predicate(statement, index, array);
          }),
      });
      const symbols = analysis.rootScope.symbols;
      const originalSymbolSome = symbols.some.bind(symbols);
      Object.defineProperty(symbols, "some", {
        configurable: true,
        value: (predicate: Parameters<typeof symbols.some>[0]) =>
          originalSymbolSome((symbol, index, array) => {
            literalWork.rootSymbolVisits += 1;
            return predicate(symbol, index, array);
          }),
      });
      return analysis;
    },
  };
});

vi.mock("../../utils/get-node-start-index.js", async (importOriginal) => {
  const originalModule =
    await importOriginal<typeof import("../../utils/get-node-start-index.js")>();
  return {
    getNodeStartIndex: (node: EsTreeNode): number => {
      literalWork.nodeStartReads += 1;
      return originalModule.getNodeStartIndex(node);
    },
  };
});

describe("Error prose literal lookup work", () => {
  it.each([
    { recordCount: ERROR_PROSE_WORK_SMALL_RECORD_COUNT, hasErasedError: false },
    { recordCount: ERROR_PROSE_WORK_LARGE_RECORD_COUNT, hasErasedError: false },
    { recordCount: ERROR_PROSE_WORK_SMALL_RECORD_COUNT, hasErasedError: true },
    { recordCount: ERROR_PROSE_WORK_LARGE_RECORD_COUNT, hasErasedError: true },
  ])(
    "bounds lookup work for $recordCount records with erased Error $hasErasedError",
    ({ recordCount, hasErasedError }) => {
      const content =
        (hasErasedError ? "interface Error { note: string }\n" : "") +
        Array.from(
          { length: recordCount },
          (_, recordIndex) => `export class Record${recordIndex} {
  constructor() { this.key = Math.random(); } fail() { throw new Error("Invalid token in expression"); }
}`,
        ).join("\n\n");
      literalWork.nodeStartReads = 0;
      literalWork.rootStatementVisits = 0;
      literalWork.rootSymbolVisits = 0;
      expect(runScanRule(insecureCryptoRisk, { relativePath: "src/records.ts", content })).toEqual(
        [],
      );
      expect(literalWork.nodeStartReads).toBeGreaterThan(0);
      expect(literalWork.rootStatementVisits).toBeGreaterThan(0);
      expect(literalWork.rootStatementVisits).toBeLessThanOrEqual(
        recordCount + Number(hasErasedError),
      );
      expect(literalWork.rootSymbolVisits).toBe(hasErasedError ? recordCount + 1 : 0);
      expect(literalWork.nodeStartReads).toBeLessThanOrEqual(
        recordCount *
          (Math.ceil(Math.log2(recordCount)) + ERROR_PROSE_LITERAL_LOOKUP_OVERHEAD_READ_COUNT),
      );
    },
  );
});
