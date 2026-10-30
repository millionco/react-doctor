import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { jsxPropsNoSpreading } from "./jsx-props-no-spreading.js";
import { isCsf2BoundTemplateForwarding } from "./utils/is-csf2-bound-template-forwarding.js";

const nominalCode =
  'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n';
const mixedCode =
  'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nexport const Dashboard = ({ record }) => <ActionCard {...record} />;\n';
const settings = {
  "react-doctor": {
    portedRuleMode: "curated",
    capabilities: ["react"],
    reactVersion: "18.3.1",
    reactMajorVersion: 18,
    jsxPropsNoSpreading: {
      html: "enforce",
      custom: "enforce",
      explicitSpread: "enforce",
      exceptions: [],
    },
  },
};

describe("CSF2 source and selected-role cache boundaries", () => {
  for (const plainFirst of [true, false]) {
    it(`keeps source/profile contexts fresh with plain source ${plainFirst ? "first" : "last"}`, () => {
      const parsed = parseFixture(nominalCode);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      const attributes: EsTreeNodeOfType<"JSXSpreadAttribute">[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "JSXSpreadAttribute")) attributes.push(node);
      });
      const attribute = attributes[0];
      if (!attribute) throw new Error("Expected template spread");
      const sequence = plainFirst
        ? ["plain", "pragma", "missing", "preact", "empty", "unspecified", "plain"]
        : ["unspecified", "empty", "preact", "missing", "pragma", "plain", "plain"];
      let currentSource = nominalCode;
      let getTextCalls = 0;
      const sourceCode = {
        ast: parsed.program,
        getText() {
          expect(this).toBe(sourceCode);
          getTextCalls++;
          return currentSource;
        },
      };
      const actual = sequence.map((name) => {
        currentSource = name === "pragma" ? "/** @jsx custom */\n" + nominalCode : nominalCode;
        const capabilities =
          name === "preact" ? ["react", "preact"] : name === "empty" ? [] : ["react"];
        return isCsf2BoundTemplateForwarding(attribute, {
          scopes,
          cfg,
          settings: {
            "react-doctor": {
              portedRuleMode: "curated",
              ...(name === "unspecified" ? {} : { capabilities }),
            },
          },
          ...(name === "missing" ? {} : { sourceCode }),
          report: () => {},
        });
      });
      expect(parsed.errors).toEqual([]);
      expect(actual).toEqual(sequence.map((name) => name === "plain" || name === "unspecified"));
      expect(getTextCalls).toBe(
        sequence.filter((name) => name === "plain" || name === "pragma" || name === "unspecified")
          .length,
      );
    });
  }
  for (const businessFirst of [true, false]) {
    it(`keeps business and selected-template roles separate with business visited ${businessFirst ? "first" : "last"}`, () => {
      const parsed = parseFixture(mixedCode);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      const attributes: EsTreeNodeOfType<"JSXSpreadAttribute">[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "JSXSpreadAttribute")) attributes.push(node);
      });
      const context = {
        scopes,
        cfg,
        settings,
        sourceCode: { ast: parsed.program, getText: () => mixedCode },
        report: () => {},
      };
      const ordered = businessFirst ? [...attributes].reverse() : attributes;
      expect(ordered.map((attribute) => isCsf2BoundTemplateForwarding(attribute, context))).toEqual(
        businessFirst ? [false, true] : [true, false],
      );
      expect(
        attributes.map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
      ).toEqual([true, false]);
      expect(
        [...attributes]
          .reverse()
          .map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
      ).toEqual([false, true]);
      expect(parsed.errors).toEqual([]);
    });
  }
});

describe("CSF2 existing computed-data graph decisions", () => {
  for (const fixture of [
    {
      name: "nominal",
      extra: "",
      expected: 0,
    },
    {
      name: "cycle-void",
      extra: "const selected=data[key]||selected;void selected;",
      expected: 0,
    },
    {
      name: "cycle-unsafe",
      extra: "const selected=data[key]||selected;consume(selected);",
      expected: 1,
    },
    {
      name: "shared-alias-void",
      extra: "const selected=data[key]||data[other];void selected;",
      expected: 0,
    },
    {
      name: "shared-alias-unsafe",
      extra: "const selected=data[key]||data[other];consume(selected);",
      expected: 1,
    },
  ]) {
    it(fixture.name, () => {
      const fixtureCode = nominalCode + fixture.extra;
      const parsed = parseFixture(fixtureCode);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const cfg = analyzeControlFlow(parsed.program);
      const attributes: EsTreeNodeOfType<"JSXSpreadAttribute">[] = [];
      walkAst(parsed.program, (node) => {
        if (isNodeOfType(node, "JSXSpreadAttribute")) attributes.push(node);
      });
      const context = {
        scopes,
        cfg,
        settings,
        sourceCode: { ast: parsed.program, getText: () => fixtureCode },
        report: () => {},
      };
      const expected = attributes.map(() => fixture.expected === 0);
      expect(
        attributes.map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
      ).toEqual(expected);
      expect(
        [...attributes]
          .reverse()
          .map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
      ).toEqual([...expected].reverse());
      expect(
        attributes.map((attribute) => isCsf2BoundTemplateForwarding(attribute, context)),
      ).toEqual(expected);
      const actual = runRule(jsxPropsNoSpreading, fixtureCode, {
        filename: "/synthetic/csf-work/graph.tsx",
        settings,
        includeLocations: true,
      });
      expect(parsed.errors).toEqual([]);
      expect(actual.parseErrors).toEqual([]);
      expect(actual.diagnostics).toHaveLength(fixture.expected);
    });
  }
});
