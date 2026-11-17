import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";

describe.each(["curated", "faithful"])(
  "click handler applicability in %s mode",
  (portedRuleMode) => {
    const settings = { "react-doctor": { portedRuleMode } };

    it.each([
      `<div onClick="" />`,
      `<span onClick={""}>Count</span>`,
      `<div onClickCapture="" />`,
      `<span onClickCapture={""}>Count</span>`,
    ])("does not request a key equivalent for an invalid empty string prop: %s", (markup) => {
      const result = runRule(clickEventsHaveKeyEvents, `export const Display = () => ${markup};`, {
        settings,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      `<div onClick={performAction} />`,
      `<span onClick={() => performAction()}>Act</span>`,
      `<div onClickCapture={performAction} />`,
      `<div onClick="" onClickCapture={performAction} />`,
      `<div onClickCapture="" onClick={performAction} />`,
      `<div onClick="" onClick={performAction} />`,
      `<div onClick={performAction} onClick="" />`,
      `<div onClick="" onClick="" />`,
      `<div onClick="performAction()" />`,
      `<div onClick={" "} />`,
      `<div onClick={false} />`,
      `<div onClick={0} />`,
      `<div onClick={null} />`,
      `<div onClick={undefined} />`,
      `<div onClick={opaqueHandler} />`,
      `<div onClick={enabled ? "" : performAction} />`,
      "<div onClick={``} />",
    ])("retains the existing boundary for other click values: %s", (markup) => {
      const result = runRule(
        clickEventsHaveKeyEvents,
        `export const Action = ({ performAction, opaqueHandler, enabled }) => ${markup};`,
        { settings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("does not resolve an empty binding into a broad constant exception", () => {
      const result = runRule(
        clickEventsHaveKeyEvents,
        `const handler = "";
      export const Action = ({ handler }) => <div onClick={handler} />;`,
        { settings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("keeps callable siblings while skipping only the empty display prop", () => {
      const result = runRule(
        clickEventsHaveKeyEvents,
        `export const Stepper = ({ decrease, increase }) => <>
      <span onClick={decrease}>Less</span><span onClick="">Value</span><span onClick={increase}>More</span>
    </>;`,
        { settings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    });
  },
);

describe("empty click props with event spreads", () => {
  it.each([
    `<div onClick="" {...props} />`,
    `<div {...props} onClick="" />`,
    `<div onClick="" {...{ onClickCapture: performAction }} />`,
    `<div {...{ onClick: "" }} />`,
  ])("keeps faithful diagnostics at the existing spread boundary: %s", (markup) => {
    const result = runRule(
      clickEventsHaveKeyEvents,
      `export const Action = ({ props, performAction }) => ${markup};`,
      {
        settings: { "react-doctor": { portedRuleMode: "faithful" } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
