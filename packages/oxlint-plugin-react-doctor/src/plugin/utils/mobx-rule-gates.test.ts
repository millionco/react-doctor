import { describe, expect, it } from "vite-plus/test";
import { ruleRegistry } from "../rule-registry.js";
import { MOBX_RULE_GATES } from "./mobx-rule-gates.js";

describe("MOBX_RULE_GATES", () => {
  it("gates every researched rule on a supported direct MobX core version", () => {
    expect(Object.keys(MOBX_RULE_GATES)).toHaveLength(20);

    for (const gate of Object.values(MOBX_RULE_GATES)) {
      expect(gate.requires.some((capability) => /^mobx:[456]$/.test(capability))).toBe(true);
    }
  });

  it("requires every registered MobX rule to use its researched gate", () => {
    const registeredMobxRules = Object.entries(ruleRegistry).filter(([ruleId]) =>
      ruleId.startsWith("mobx-"),
    );

    for (const [ruleId, rule] of registeredMobxRules) {
      const gateEntry = Object.entries(MOBX_RULE_GATES).find(
        ([gateRuleId]) => gateRuleId === ruleId,
      );
      expect(gateEntry, `${ruleId} must declare a gate in MOBX_RULE_GATES`).toBeDefined();
      if (gateEntry === undefined) continue;

      expect(rule.requires).toEqual(gateEntry[1].requires);
      const disabledWhen = "disabledWhen" in gateEntry[1] ? gateEntry[1].disabledWhen : undefined;
      expect(rule.disabledWhen).toEqual(disabledWhen);
    }
  });

  it("gates React integration rules on React and the exact binding family", () => {
    expect(MOBX_RULE_GATES["mobx-no-observer-wrapped-memo"].requires).toEqual([
      "mobx:4",
      "mobx-react-binding",
      "react",
    ]);
    expect(MOBX_RULE_GATES["mobx-observer-before-inject"].requires).toEqual([
      "mobx:4",
      "mobx-react",
      "react",
    ]);
    expect(MOBX_RULE_GATES["mobx-observer-class-no-should-component-update"].requires).toEqual([
      "mobx:4",
      "mobx-react",
      "react",
    ]);
  });

  it("requires MobX 6 for APIs and semantics introduced by MobX 6", () => {
    for (const ruleId of [
      "mobx-no-make-auto-observable-in-inheritance",
      "mobx-make-observable-unconditional",
      "mobx-legacy-decorator-needs-make-observable",
      "mobx-initialize-before-make-auto-observable",
      "mobx-no-invalid-observable-override",
    ] as const) {
      expect(MOBX_RULE_GATES[ruleId].requires).toContain("mobx:6");
    }
  });

  it("disables observer coverage when the build transform supplies it", () => {
    expect(MOBX_RULE_GATES["mobx-observable-read-needs-observer"].disabledWhen).toEqual([
      "mobx-react-observer",
    ]);
  });

  it("requires an SSR runtime before checking static rendering", () => {
    expect(MOBX_RULE_GATES["mobx-enable-static-rendering-for-ssr"].requires).toEqual([
      "mobx:4",
      "mobx-react-binding",
      "react",
      "ssr",
    ]);
  });
});
