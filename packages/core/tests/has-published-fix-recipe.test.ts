import { describe, expect, it } from "vite-plus/test";
import { hasPublishedFixRecipe } from "@react-doctor/core";

describe("hasPublishedFixRecipe", () => {
  it("is true for react-doctor engine rules (recipes are generated from them)", () => {
    expect(hasPublishedFixRecipe({ plugin: "react-doctor", rule: "no-array-index-key" })).toBe(
      true,
    );
    expect(hasPublishedFixRecipe({ plugin: "react-doctor", rule: "no-derived-state" })).toBe(true);
  });

  it("is false for dead-code diagnostics (deslop has no recipes)", () => {
    expect(hasPublishedFixRecipe({ plugin: "deslop", rule: "unused-file" })).toBe(false);
    expect(hasPublishedFixRecipe({ plugin: "deslop", rule: "circular-dependency" })).toBe(false);
  });

  it("is false for react-doctor-namespaced synthetic environment checks", () => {
    // Emitted by checkReducedMotion / checkPnpmHardening — not engine
    // lint rules, so no recipe page exists.
    expect(hasPublishedFixRecipe({ plugin: "react-doctor", rule: "require-reduced-motion" })).toBe(
      false,
    );
    expect(hasPublishedFixRecipe({ plugin: "react-doctor", rule: "require-pnpm-hardening" })).toBe(
      false,
    );
    expect(
      hasPublishedFixRecipe({
        plugin: "react-doctor",
        rule: "no-vulnerable-react-server-components",
      }),
    ).toBe(false);
  });

  it("is false for adopted third-party plugins", () => {
    expect(hasPublishedFixRecipe({ plugin: "eslint", rule: "no-unused-vars" })).toBe(false);
    expect(hasPublishedFixRecipe({ plugin: "unicorn", rule: "no-array-for-each" })).toBe(false);
    expect(hasPublishedFixRecipe({ plugin: "react-hooks-js", rule: "exhaustive-deps" })).toBe(
      false,
    );
  });
});
