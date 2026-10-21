import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import {
  TANSTACK_FORM_WORK_LARGE_COMPONENT_COUNT,
  TANSTACK_FORM_WORK_SMALL_COMPONENT_COUNT,
} from "../../constants/thresholds.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const scopeAnalysisWork = vi.hoisted(() => ({ providerAnalyses: 0 }));

vi.mock("../../semantic/scope-analysis.js", async (importOriginal) => {
  const originalModule = await importOriginal<typeof import("../../semantic/scope-analysis.js")>();
  return {
    ...originalModule,
    analyzeScopes: (program: EsTreeNode): ScopeAnalysis => {
      if (
        isNodeOfType(program, "Program") &&
        program.body.some(
          (statement) =>
            isNodeOfType(statement, "ImportDeclaration") &&
            statement.source.value === "@tanstack/react-form",
        )
      ) {
        scopeAnalysisWork.providerAnalyses += 1;
      }
      return originalModule.analyzeScopes(program);
    },
  };
});

const componentCounts = [
  TANSTACK_FORM_WORK_SMALL_COMPONENT_COUNT,
  TANSTACK_FORM_WORK_LARGE_COMPONENT_COUNT,
];

const buildForms = (componentCount: number, hasSeparateFactories = false): string =>
  Array.from({ length: componentCount }, (_, componentIndex) => {
    const factoryName = hasSeparateFactories ? `decorate${componentIndex}` : "withForm";
    const factory = hasSeparateFactories
      ? `const { withForm: ${factoryName} } = createFormHook({});`
      : "";
    return `${factory}
      const Form${componentIndex} = ${factoryName}({
        render: () => {
          const [value] = useState(0);
          return <output>{value}</output>;
        },
      });`;
  }).join("\n");

const buildMounts = (componentCount: number): string =>
  `export const App = () => <>${Array.from(
    { length: componentCount },
    (_, componentIndex) => `<Form${componentIndex} />`,
  ).join("")}</>;`;

describe("TanStack Form render proof work", () => {
  it.each(
    componentCounts.flatMap((componentCount) => [
      { componentCount, hasSeparateFactories: false, mutation: "" },
      { componentCount, hasSeparateFactories: true, mutation: "" },
      { componentCount, hasSeparateFactories: false, mutation: "withForm = replacement;" },
      { componentCount, hasSeparateFactories: true, mutation: "createFormHook = replacement;" },
    ]),
  )(
    "checks each factory reference once: $componentCount $hasSeparateFactories $mutation",
    ({ componentCount, hasSeparateFactories, mutation }) => {
      let referenceFlagReads = 0;
      let referenceCount = 0;
      const profiledRule: typeof rulesOfHooks = {
        ...rulesOfHooks,
        create: (context) => {
          const bindingName = hasSeparateFactories ? "createFormHook" : "withForm";
          const symbol = context.scopes.rootScope.symbols.find(
            (candidate) => candidate.name === bindingName,
          );
          if (!symbol) throw new Error("Expected form factory binding");
          referenceCount = symbol.references.length;
          for (const reference of symbol.references) {
            const originalFlag = reference.flag;
            Object.defineProperty(reference, "flag", {
              configurable: true,
              get: () => {
                referenceFlagReads += 1;
                return originalFlag;
              },
            });
          }
          return rulesOfHooks.create(context);
        },
      };
      const source = `
        import { useState } from "react";
        import { createFormHook } from "@tanstack/react-form";
        ${hasSeparateFactories ? "" : "const { withForm } = createFormHook({});"}
        ${buildForms(componentCount, hasSeparateFactories)}
        ${buildMounts(componentCount)}
        ${mutation}
      `;
      const result = runRule(profiledRule, source, { filename: "forms.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(mutation ? componentCount : 0);
      expect(referenceFlagReads).toBeGreaterThan(0);
      expect(referenceFlagReads).toBeLessThanOrEqual(referenceCount);
    },
  );

  it.each(componentCounts)(
    "analyzes an imported facade once for %s mounted forms",
    (componentCount) => {
      const directory = mkdtempSync(join(tmpdir(), "rd-form-proof-work-"));
      try {
        writeFileSync(
          join(directory, "form.ts"),
          'import { createFormHook } from "@tanstack/react-form"; export const { withForm } = createFormHook({});',
        );
        resetFilesystemCaches();
        scopeAnalysisWork.providerAnalyses = 0;
        const result = runRule(
          rulesOfHooks,
          `import { withForm } from "./form"; import { useState } from "react";
         ${buildForms(componentCount)}
         ${buildMounts(componentCount)}`,
          { filename: join(directory, "forms.tsx") },
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        expect(scopeAnalysisWork.providerAnalyses).toBe(1);
      } finally {
        resetFilesystemCaches();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
