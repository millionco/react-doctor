import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const WRAPPER = `
import React from "react";
const useBrowserEffect = (onChange: React.EffectCallback, values?: React.DependencyList) => {
  if (typeof window === "undefined") {
    return React.useEffect(onChange, values);
  }
  return React.useLayoutEffect(onChange, values);
};
`;

const widget = (body: string): string => `
export function Widget({ id, locale }: { id: string; locale: string }) {
  ${body}
  return null;
}
`;

const checkedCall = "useBrowserEffect(() => console.log(id), [id]);";
const opaqueMessage = "callback is defined elsewhere";

const check = (source: string, options?: Parameters<typeof runRule>[2]) => {
  const result = runRule(exhaustiveDeps, source, options);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ message }) => message);
};

describe("closed browser effect forwarding", () => {
  it("checks complete dependencies at direct callers", () => {
    const source = WRAPPER + widget(checkedCall);
    expect(check(source)).toEqual([]);
    expect(check(source, { settings: { "react-doctor": { portedRuleMode: "upstream" } } })).toEqual(
      [expect.stringContaining(opaqueMessage), expect.stringContaining(opaqueMessage)],
    );
  });

  it("reports a missing capture in any caller with the wrapper name", () => {
    expect(
      check(WRAPPER + widget(checkedCall + "useBrowserEffect(() => console.log(locale), []);")),
    ).toEqual([expect.stringMatching(/useBrowserEffect.*locale/)]);
  });

  it.each([
    ["aliases", "const useAlternate = useBrowserEffect;"],
    ["exports", "export { useBrowserEffect };"],
    ["optional calls", widget("useBrowserEffect?.(() => console.log(id), []);")],
    ["a second React import", 'import ReactAgain from "react"; Object.assign(ReactAgain, {});'],
    ["inherited React methods", "Object.assign(React.valueOf(), {});"],
  ])("retains the original warnings when there are %s", (_reason, escape) => {
    expect(check(WRAPPER + escape + widget(checkedCall))).toEqual([
      expect.stringContaining(opaqueMessage),
      expect.stringContaining(opaqueMessage),
    ]);
  });

  it("retains opaque-call warnings if ordinary analysis stops early", () => {
    const source =
      WRAPPER +
      widget("let current = id; useBrowserEffect(() => { current = locale; }, [locale]);");
    expect(check(source)).toEqual([
      expect.stringContaining("Assigning to `current`"),
      expect.stringContaining(opaqueMessage),
      expect.stringContaining(opaqueMessage),
    ]);
  });

  it("keeps explicit additionalHooks dependency policy", () => {
    const source = WRAPPER + widget("useBrowserEffect(() => console.log(id), [id, locale]);");
    expect(check(source)).toEqual([]);
    expect(
      check(source, {
        settings: { "react-doctor": { exhaustiveDeps: { additionalHooks: "^useBrowserEffect$" } } },
      }),
    ).toEqual([expect.stringMatching(/useBrowserEffect.*locale/)]);
  });
});
