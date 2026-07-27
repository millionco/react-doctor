import { describe, expect, it } from "vite-plus/test";
import { parseFixture, runRule, runRuleOnParsedFixture } from "./rule-engine-testkit.js";
import type { Rule } from "./rule-engine-testkit.js";

const SOURCE_TEXT = `const Component = () => {
  return <button>Save</button>;
};`;

const buildRule = (visitorOrder: string[]): Rule => ({
  id: "rule-engine-testkit-parity",
  severity: "warn",
  create: (context) => ({
    Program: (node) => {
      visitorOrder.push(`enter:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
    },
    ArrowFunctionExpression: (node) => {
      visitorOrder.push(`enter:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
      const functionScope = context.scopes.ownScopeFor(node);
      const controlFlow = context.cfg.cfgFor(node);
      context.report({
        node,
        message: `${functionScope?.kind}:${controlFlow !== null}`,
      });
    },
    JSXElement: (node) => {
      visitorOrder.push(`enter:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
      context.report({
        node,
        message: `${node.loc.start.line}:${node.loc.start.column}`,
      });
    },
    "JSXElement:exit": (node) => {
      visitorOrder.push(`exit:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
    },
    "ArrowFunctionExpression:exit": (node) => {
      visitorOrder.push(`exit:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
    },
    "Program:exit": (node) => {
      visitorOrder.push(`exit:${node.type}@${node.loc.start.line}:${node.loc.start.column}`);
    },
  }),
});

describe("rule engine testkit", () => {
  it("preserves parsed and source runner diagnostics, visitor ordering, and locations", () => {
    const sourceVisitorOrder: string[] = [];
    const parsedVisitorOrder: string[] = [];
    const sourceResult = runRule(buildRule(sourceVisitorOrder), SOURCE_TEXT, {
      filename: "fixture.tsx",
    });
    const parsed = parseFixture(SOURCE_TEXT, { filename: "fixture.tsx" });
    const parsedResult = runRuleOnParsedFixture(
      buildRule(parsedVisitorOrder),
      SOURCE_TEXT,
      parsed,
      { filename: "fixture.tsx" },
    );

    expect(sourceResult).toEqual({
      diagnostics: [
        {
          message: "arrow-function:true",
          nodeType: "ArrowFunctionExpression",
        },
        {
          message: "2:9",
          nodeType: "JSXElement",
        },
      ],
      parseErrors: [],
    });
    expect(parsedResult).toEqual(sourceResult);
    expect(sourceVisitorOrder).toEqual([
      "enter:Program@1:0",
      "enter:ArrowFunctionExpression@1:18",
      "enter:JSXElement@2:9",
      "exit:JSXElement@2:9",
      "exit:ArrowFunctionExpression@1:18",
      "exit:Program@1:0",
    ]);
    expect(parsedVisitorOrder).toEqual(sourceVisitorOrder);
  });
});
