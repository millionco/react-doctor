import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRuleOnParsedFixture } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import type { Rule } from "../../utils/rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  INTERVAL_OBSERVER_CONTEXT_ANALYSIS_COUNT,
  INTERVAL_OBSERVER_PROOF_COUNTS,
  INTERVAL_OBSERVER_PROGRAM_BODY_READ_LIMIT,
} from "../../../test-utils/interval-observer-proof/constants.js";

const component = `export const ObserverPanel = ({ target, enabled, consume }: { target: Element; enabled: boolean; consume: (value: unknown) => void }) => {
  useEffect(() => {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {});
      const interval = setInterval(() => {
        if (target) {
          clearInterval(interval);
          observer.observe(target);
        }
      }, 10);
      return () => {
        clearInterval(interval);
        observer.disconnect();
      };
    }
  }, [target]);
  return <div />;
};`;

const settings = { "react-doctor": { capabilities: ["react"] } };

describe("native interval observer Program proof work", () => {
  for (const shape of ["single-owner-padding", "multiple-owners-declined"]) {
    for (const count of INTERVAL_OBSERVER_PROOF_COUNTS) {
      it(`${shape} ${count}`, () => {
        const source = `import { useEffect } from 'react';\n${
          shape === "single-owner-padding"
            ? `${Array.from({ length: count }, (_, index) => `const padding${index}=${index};`).join("\n")}\n${component}`
            : Array.from({ length: count }, (_, index) =>
                component.replace("ObserverPanel", `ObserverPanel${index}`),
              ).join("\n")
        }`;
        const parsed = parseFixture(source);
        expect(parsed.errors).toEqual([]);
        if (!isNodeOfType(parsed.program, "Program"))
          throw new Error("Program fixture is required");
        let programBodyReads = 0;
        const descriptor = Object.getOwnPropertyDescriptor(parsed.program, "body");
        expect(descriptor).toBeDefined();
        if (!descriptor) throw new Error("Program body property is required");
        const body = parsed.program.body;
        const measuredRule: Rule = {
          ...effectNeedsCleanup,
          create: (context) => {
            void context.scopes;
            void context.cfg;
            Object.defineProperty(parsed.program, "body", {
              configurable: true,
              enumerable: descriptor.enumerable,
              get: () => {
                programBodyReads += 1;
                return body;
              },
            });
            return effectNeedsCleanup.create(context);
          },
        };
        try {
          const result = runRuleOnParsedFixture(measuredRule, source, parsed, { settings });
          expect(result.parseErrors).toEqual([]);
          expect(result.diagnostics).toHaveLength(shape === "single-owner-padding" ? 0 : count);
          expect(programBodyReads).toBeLessThanOrEqual(INTERVAL_OBSERVER_PROGRAM_BODY_READ_LIMIT);
        } finally {
          Object.defineProperty(parsed.program, "body", descriptor);
        }
        const missingDisconnect = source.replaceAll("        observer.disconnect();", "");
        const control = runRuleOnParsedFixture(
          effectNeedsCleanup,
          missingDisconnect,
          parseFixture(missingDisconnect),
          { settings },
        );
        expect(control.parseErrors).toEqual([]);
        expect(control.diagnostics).toHaveLength(shape === "single-owner-padding" ? 1 : count);
      });
    }
  }
});

const contextCases = [
  {
    name: "nominal owner",
    code: `import { useEffect } from 'react';\n${component}`,
    expectedWarningsPerCall: [0],
  },
  {
    name: "two independent owners remain declined",
    code: `import { useEffect } from 'react';\n${component.replace("ObserverPanel", "FirstPanel")}\n${component.replace("ObserverPanel", "SecondPanel")}`,
    expectedWarningsPerCall: [1, 1],
  },
];

describe("native interval observer Program fact contexts", () => {
  for (const control of contextCases) {
    it(control.name, () => {
      const parsed = parseFixture(control.code);
      expect(parsed.errors).toEqual([]);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Program fixture is required");
      const analyses: ScopeAnalysis[] = [];
      for (const shouldReverse of [false, true]) {
        let warningCount = 0;
        const measuredRule: Rule = {
          ...effectNeedsCleanup,
          create: (context) => {
            analyses.push(context.scopes);
            expect(context.scopes.rootScope.node).toBe(parsed.program);
            const visitors = effectNeedsCleanup.create({
              ...context,
              report: (descriptor) => {
                warningCount += 1;
                context.report(descriptor);
              },
            });
            return {
              Program: () => {
                const calls: EsTreeNodeOfType<"CallExpression">[] = [];
                walkAst(parsed.program, (node) => {
                  if (
                    isNodeOfType(node, "CallExpression") &&
                    isNodeOfType(node.callee, "Identifier") &&
                    node.callee.name === "useEffect"
                  ) {
                    calls.push(node);
                  }
                });
                expect(calls).toHaveLength(control.expectedWarningsPerCall.length);
                const order = calls.map((_, index) => index);
                if (shouldReverse) order.reverse();
                const sequence = [...order, ...order, ...order.toReversed()];
                const handler = visitors.CallExpression;
                if (typeof handler !== "function")
                  throw new Error("Effect call visitor is required");
                for (const index of sequence) {
                  const before = warningCount;
                  const effectCall = calls[index];
                  if (!effectCall) throw new Error("Selected effect call is required");
                  handler(effectCall);
                  expect(warningCount - before).toBe(control.expectedWarningsPerCall[index]);
                }
              },
            };
          },
        };
        const result = runRuleOnParsedFixture(measuredRule, control.code, parsed, { settings });
        expect(result.parseErrors).toEqual([]);
      }
      expect(analyses).toHaveLength(INTERVAL_OBSERVER_CONTEXT_ANALYSIS_COUNT);
      expect(analyses[0]).not.toBe(analyses[1]);
    });
  }
});
