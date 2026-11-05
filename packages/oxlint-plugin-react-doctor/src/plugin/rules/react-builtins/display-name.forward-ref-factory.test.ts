import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

const factory = `
  import React from "react";
  const makeCard = (tag) => {
    return React.forwardRef((props, ref) => <div ref={ref}>{tag}{props.children}</div>);
  };
`;

const namedResults = `
  const Summary = makeCard("summary");
  Summary.displayName = "Summary";
  const Detail = makeCard("detail");
  Detail.displayName = "Detail";
  export { Summary, Detail };
`;

const countDiagnostics = (source: string, portedRuleMode = "curated"): number => {
  const result = runRule(displayName, source, {
    settings: { "react-doctor": { portedRuleMode } },
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("display-name forwardRef factory results", () => {
  it("accepts two separately named results from a private factory", () => {
    expect(countDiagnostics(factory + namedResults)).toBe(0);
  });

  it("accepts a direct named React import", () => {
    expect(
      countDiagnostics(`
        import { forwardRef } from "react";
        const makeCard = () => forwardRef((props, ref) => <div ref={ref}>{props.children}</div>);
        const Card = makeCard();
        Card.displayName = "Card";
        export { Card };
      `),
    ).toBe(0);
  });

  it("preserves the upstream warning outside curated mode", () => {
    expect(countDiagnostics(factory + namedResults, "strict")).toBe(1);
  });

  it.each([
    ["an unnamed additional invocation", "const Unnamed = makeCard('other');"],
    ["an exported factory", "export { makeCard };"],
    ["an aliased factory", "const alias = makeCard;"],
    ["a later write to a result", 'Summary.displayName = "";'],
    ["an indirect invocation through eval", 'eval("makeCard()");'],
    ["a replaced React method", "React.forwardRef = fake;"],
    ["a React namespace escape", "const alias = React; alter(alias);"],
    ["an inherited namespace mutator", 'React.__defineGetter__("forwardRef", () => fake);'],
    ["a second React provider through a loader", 'module.require("react").forwardRef = fake;'],
    [
      "a loader imported through a module binding",
      'import { createRequire } from "node:module"; createRequire(import.meta.url)("react").forwardRef = fake;',
    ],
    [
      "a replaced React method through another import",
      'import otherReact from "react"; otherReact.forwardRef = fake;',
    ],
  ])("still reports with %s", (_name, extra) => {
    expect(countDiagnostics(factory + namedResults + extra)).toBe(1);
  });

  it.each([
    ["a conditional name", 'if (enabled) Summary.displayName = "Summary";'],
    ["a different receiver", 'Another.displayName = "Summary";'],
    ["an empty name", 'Summary.displayName = "  ";'],
    ["an escape before naming", 'publish(Summary); Summary.displayName = "Summary";'],
  ])("still reports with %s", (_name, naming) => {
    expect(countDiagnostics(factory + 'const Summary = makeCard("summary");' + naming)).toBe(1);
  });

  it("still reports a shadowed forwardRef provider", () => {
    expect(
      countDiagnostics(`
        const makeCard = (React) => React.forwardRef(() => <div />);
        const Summary = makeCard(mockReact);
        Summary.displayName = "Summary";
      `),
    ).toBe(1);
  });
});
