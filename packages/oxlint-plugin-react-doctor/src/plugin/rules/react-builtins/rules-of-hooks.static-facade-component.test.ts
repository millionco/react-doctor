import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const rule = wrapWithSemanticContext(rulesOfHooks) as Rule;
const body = "const [active] = useState(false); return <section hidden={!active} />;";
const jsxConsumer = "export const Screen = () => <Panels.Card />;";
const facadeAlias = "static LegacyCard: React.FC = Panels.Card;";

const fixture = ({
  componentBody = body,
  facadeField = "static Card: React.FC",
  otherFields = "",
  uses = jsxConsumer,
  reactSource = "react",
  classSuffix = "",
} = {}): string => `
  import React from "${reactSource}";
  import { useState } from "react";

  export class Panels ${classSuffix} {
    ${facadeField} = () => { ${componentBody} };
    ${otherFields}
  }
  ${uses}
`;

const messages = (code: string): string[] => {
  const result = runRule(rule, code, { filename: "panels.tsx" });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ message }) => message);
};

describe("rules-of-hooks static facade components", () => {
  it("accepts an exported component field used as JSX", () => {
    expect(messages(fixture())).toEqual([]);
  });

  it("accepts a typed same-class alias of a field returning JSX", () => {
    expect(messages(fixture({ otherFields: facadeAlias, uses: "" }))).toEqual([]);
  });

  it.each([
    [
      "conditional",
      "if (Math.random() > 0.5) useState(false); return <section />;",
      "conditionally",
    ],
    [
      "loop",
      "for (let count = 0; count < 2; count++) useState(false); return <section />;",
      "loop",
    ],
  ])("reports Hook order when a static component uses a %s", (_name, componentBody, fragment) => {
    const findings = messages(fixture({ componentBody }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(fragment);
  });

  it.each([
    ["no component witness", { uses: "" }],
    ["an instance member", { facadeField: "Card: React.FC" }],
    ["a private field", { facadeField: "private static Card: React.FC" }],
    ["a protected field", { facadeField: "protected static Card: React.FC" }],
    ["a type imported from another library", { reactSource: "fake-react" }],
    ["an ordinary call to the member", { uses: jsxConsumer + " Panels.Card({});" }],
    ["an ordinary call to the alias", { otherFields: facadeAlias, uses: "Panels.LegacyCard({});" }],
    ["a member discarded outside JSX", { uses: "void Panels.Card;" }],
    ["a replaced member", { uses: jsxConsumer + " Panels.Card = () => null;" }],
    ["a subclass", { classSuffix: "extends React.Component" }],
    [
      "a nested callback",
      { componentBody: "const start = () => useState(false); return <button onClick={start} />;" },
    ],
    ["a non-rendering arrow", { componentBody: "useState(false); return null;" }],
  ] as const)("still reports %s", (_name, options) => {
    expect(messages(fixture(options))).toHaveLength(1);
  });
});
